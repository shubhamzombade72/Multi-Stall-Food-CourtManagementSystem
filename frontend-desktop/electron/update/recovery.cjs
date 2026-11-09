/**
 * Recovery points: everything needed to put a client back as it was before a database-changing update (no Electron imports).
 *
 *   recovery/<id>/foodcourt.sqlite   consistent copy, written and checked by the API (`foodcourt:backup`, VACUUM INTO)
 *   recovery/<id>/attachments/       storage/app (menu images)
 *   recovery/<id>/config/            app.key and this PC's settings files
 *   recovery/<id>/snapshot.json      counts and totals of business data
 *   recovery/<id>/metadata.json      written LAST with a checksum of every file, so its presence means "complete"
 *
 * A recovery point is never overwritten, and pruning never removes the newest complete one or one still referenced.
 * The restore decision is a separate pure function so that the rule can be read and tested on its own.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { sha256File, writeJsonDurable, readJsonOr } = require('./format.cjs');
const { parseReport } = require('../backup.cjs');

const KEEP_RECOVERY_POINTS = 3;
const CONFIG_FILES = ['config.json', 'pairing.json', 'desktop-settings.json', 'auth-vault.json', path.join('printing', 'config.json'), path.join('printing', 'jobs.json')];

function walkFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function dirBytes(dir) {
  return walkFiles(dir).reduce((total, rel) => total + fs.statSync(path.join(dir, ...rel.split('/'))).size, 0);
}

/** Bytes an update needs free, or the update does not start. Twice the database leaves room for the backup and for growth. */
function requiredBytes({ dbBytes = 0, attachmentBytes = 0, treeBytes = 0, payloadBytes = 0 }) {
  return dbBytes * 2 + attachmentBytes + treeBytes + payloadBytes + 200 * 1024 * 1024;
}

async function checkDiskSpace(dir, needed, statfs = fs.promises.statfs) {
  fs.mkdirSync(dir, { recursive: true });
  const s = await statfs(dir);
  const free = Number(s.bavail) * Number(s.bsize);
  return { ok: free >= needed, free, needed };
}

async function artisanJson(artisan, args) {
  let output;
  try {
    output = await artisan(args);
  } catch (err) {
    output = err && err.output;
  }
  return parseReport(output);
}

/**
 * Creates and verifies a recovery point. The server must already be stopped, so nothing can change while it is made.
 * Returns { ok, id, dir, metadata } or { ok:false, error }. A failed attempt leaves nothing that looks complete.
 */
async function createRecoveryPoint({ artisan, dataDir, userData, recoveryRoot, fromVersion, toVersion, log = () => undefined }) {
  const id = `rp-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const dir = path.join(recoveryRoot, id);
  fs.mkdirSync(recoveryRoot, { recursive: true });
  fs.mkdirSync(dir); // fails rather than reusing an existing folder

  try {
    const db = path.join(dataDir, 'foodcourt.sqlite');
    const hasDb = fs.existsSync(db) && fs.statSync(db).size > 0;
    if (hasDb) {
      const report = await artisanJson(artisan, ['foodcourt:backup', path.join(dir, 'foodcourt.sqlite')]);
      if (!report || !report.ok) throw new Error((report && report.problems && report.problems[0]) || 'The database backup could not be created.');
      const snap = await artisanJson(artisan, ['foodcourt:update-db', 'snapshot']);
      if (!snap || !snap.ok || !snap.snapshot) throw new Error('The business data could not be measured before the update.');
      if (snap.snapshot.integrity !== 'ok') throw new Error('The database failed its integrity check. The update was not started.');
      writeJsonDurable(path.join(dir, 'snapshot.json'), snap.snapshot);
    }

    const attachments = path.join(dataDir, 'storage', 'app');
    if (fs.existsSync(attachments)) fs.cpSync(attachments, path.join(dir, 'attachments'), { recursive: true, force: false, errorOnExist: false });

    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const keepConfig = (from, rel) => {
      if (!fs.existsSync(from)) return;
      const to = path.join(configDir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    };
    keepConfig(path.join(dataDir, 'app.key'), path.join('server', 'app.key'));
    keepConfig(path.join(dataDir, 'last-version.txt'), path.join('server', 'last-version.txt'));
    CONFIG_FILES.forEach((rel) => keepConfig(path.join(userData, rel), path.join('userdata', rel)));

    const files = {};
    for (const rel of walkFiles(dir)) files[rel] = { sha256: await sha256File(path.join(dir, ...rel.split('/'))), bytes: fs.statSync(path.join(dir, ...rel.split('/'))).size };
    const metadata = { id, created_at: new Date().toISOString(), from_version: fromVersion, to_version: toVersion, has_database: hasDb, files };
    writeJsonDurable(path.join(dir, 'metadata.json'), metadata);

    const verified = await verifyRecoveryPoint(dir);
    if (!verified.ok) throw new Error(verified.error);
    if (hasDb) {
      const check = await artisanJson(artisan, ['foodcourt:backup', path.join(dir, 'foodcourt.sqlite'), '--verify']);
      if (!check || !check.ok) throw new Error('The database backup failed its check.');
    }
    log('INFO', `Recovery point ${id} created and verified`);
    return { ok: true, id, dir, metadata };
  } catch (err) {
    log('ERROR', `Recovery point failed: ${err.message}`);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return { ok: false, error: err.message };
  }
}

/** Re-hashes every file against its metadata. Anything missing, extra or different makes it unusable. */
async function verifyRecoveryPoint(dir) {
  const metadata = readJsonOr(path.join(dir, 'metadata.json'));
  if (!metadata || !metadata.files) return { ok: false, error: 'The recovery point is incomplete.' };
  for (const [rel, expected] of Object.entries(metadata.files)) {
    const file = path.join(dir, ...rel.split('/'));
    if (!fs.existsSync(file)) return { ok: false, error: `The recovery point is missing ${rel}.` };
    if ((await sha256File(file)) !== expected.sha256) return { ok: false, error: `The recovery point has a damaged copy of ${rel}.` };
  }
  const present = walkFiles(dir).filter((rel) => rel !== 'metadata.json' && !rel.startsWith('pre-restore-'));
  const unexpected = present.filter((rel) => !metadata.files[rel]);
  if (unexpected.length) return { ok: false, error: `The recovery point has unexpected files: ${unexpected[0]}.` };
  return { ok: true, metadata };
}

function listRecoveryPoints(root) {
  try {
    return fs.readdirSync(root)
      .filter((n) => n.startsWith('rp-') && fs.existsSync(path.join(root, n, 'metadata.json')))
      .sort();
  } catch {
    return [];
  }
}

/** Removes older complete points beyond `keep`. Never the newest ones and never a point named in `referenced`. */
function pruneRecoveryPoints(root, { keep = KEEP_RECOVERY_POINTS, referenced = [] } = {}) {
  const all = listRecoveryPoints(root);
  const removable = all.slice(0, Math.max(0, all.length - keep)).filter((n) => !referenced.includes(n));
  removable.forEach((n) => fs.rmSync(path.join(root, n), { recursive: true, force: true, maxRetries: 3 }));
  return removable;
}

/**
 * The restore rule. `phase` is how far the update got; `currentSha` is the live database now and `postMigrationSha` what
 * it was right after migrating.
 *
 *  - before any program version ran on the migrated database, nothing else could have written to it: restoring is safe
 *  - during a trial boot it is safe only if the file is byte-identical to its post-migration state
 *  - otherwise newer client transactions may be in there, so an automatic restore is refused
 */
function restoreDecision({ phase, currentSha, postMigrationSha }) {
  if (['PREPARED', 'BACKUP', 'MIGRATING', 'MIGRATED', 'INSTALLING', 'HEALTH_CHECK'].includes(phase)) return { safe: true, reason: 'no program ran on the migrated database' };
  if (phase === 'TRIAL') {
    if (postMigrationSha && currentSha === postMigrationSha) return { safe: true, reason: 'the database is unchanged since migrating' };
    return { safe: false, reason: 'the database changed after migrating; it may hold new transactions' };
  }
  return { safe: false, reason: `an automatic restore is not allowed from phase ${phase}` };
}

/**
 * Puts the recovery point's database back. Server stopped; caller already applied restoreDecision. The damaged current
 * file is kept inside the recovery point, so even this step loses nothing. Attachments and settings are only filled in if
 * missing, never overwritten: an update does not change them, and they may be newer than the recovery point.
 */
async function restoreDatabase({ dir, dataDir, userData, log = () => undefined }) {
  const verified = await verifyRecoveryPoint(dir);
  if (!verified.ok) return { ok: false, error: verified.error };
  const db = path.join(dataDir, 'foodcourt.sqlite');
  const source = path.join(dir, 'foodcourt.sqlite');

  if (verified.metadata.has_database) {
    if (!fs.existsSync(source)) return { ok: false, error: 'The recovery point holds no database.' };
    let kept = null;
    if (fs.existsSync(db) && fs.statSync(db).size > 0) {
      kept = path.join(dir, `pre-restore-${Date.now()}.sqlite`);
      fs.copyFileSync(db, kept);
    }
    const staged = `${db}.restoring`;
    fs.copyFileSync(source, staged);
    const fd = fs.openSync(staged, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    ['-wal', '-shm', '-journal'].forEach((s) => fs.rmSync(db + s, { force: true }));
    fs.renameSync(staged, db);
    log('INFO', `Database restored from ${path.basename(dir)}; previous file kept as ${kept ? path.basename(kept) : 'none'}`);
  }

  const attachments = path.join(dir, 'attachments');
  if (fs.existsSync(attachments)) fs.cpSync(attachments, path.join(dataDir, 'storage', 'app'), { recursive: true, force: false, errorOnExist: false });
  const fillIn = (from, to) => {
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  };
  fillIn(path.join(dir, 'config', 'server', 'app.key'), path.join(dataDir, 'app.key'));
  CONFIG_FILES.forEach((rel) => fillIn(path.join(dir, 'config', 'userdata', rel), path.join(userData, rel)));
  return { ok: true };
}

module.exports = {
  KEEP_RECOVERY_POINTS,
  dirBytes,
  requiredBytes,
  checkDiskSpace,
  artisanJson,
  createRecoveryPoint,
  verifyRecoveryPoint,
  listRecoveryPoints,
  pruneRecoveryPoints,
  restoreDecision,
  restoreDatabase,
};
