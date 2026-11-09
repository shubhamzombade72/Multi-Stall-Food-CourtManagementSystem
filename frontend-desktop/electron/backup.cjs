/**
 * Backup and restore for the single-PC database (no Electron imports; the main process supplies dialogs).
 *
 * A backup counts only after the API has opened the copy as its own database and checked it
 * (`foodcourt:backup`). Backups are never overwritten, automatic ones are pruned (the newest 14 are kept),
 * manual and "before restore" copies are never deleted by the app.
 */
const fs = require('node:fs');
const path = require('node:path');

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_AUTO = 14;
const AUTO_PREFIX = 'foodcourt-auto-';

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');

/** foodcourt-<kind>-<timestamp>.sqlite; kind is one of auto | manual | before-restore */
function backupFileName(kind, date = new Date()) {
  return `foodcourt-${kind}-${stamp(date)}.sqlite`;
}

/** Names to delete so that only the newest `keep` automatic backups remain. Other kinds are never selected. */
function selectToPrune(names, keep = KEEP_AUTO) {
  const auto = names.filter((n) => n.startsWith(AUTO_PREFIX) && n.endsWith('.sqlite')).sort();
  return auto.slice(0, Math.max(0, auto.length - keep));
}

/** The API prints one JSON line; tolerate other output around it. */
function parseReport(output) {
  const lines = String(output || '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      try {
        return JSON.parse(t);
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/** True when no verified automatic backup was made in the last 24 hours. */
function autoBackupDue(lastSuccessIso, now = Date.now()) {
  const last = Date.parse(lastSuccessIso || '');
  return !Number.isFinite(last) || now - last >= DAY_MS;
}

/** A backup folder is usable only if the app can really create a file in it. */
function folderWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function listBackups(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /^foodcourt-.*\.sqlite$/.test(n))
      .map((n) => {
        const st = fs.statSync(path.join(dir, n));
        const kind = n.startsWith(AUTO_PREFIX) ? 'automatic' : n.startsWith('foodcourt-manual-') ? 'manual' : n.startsWith('foodcourt-before-restore-') ? 'before restore' : n.startsWith('foodcourt-before-') ? 'before upgrade' : 'other';
        return { name: n, bytes: st.size, modified: st.mtime.toISOString(), kind };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

/**
 * Creates a verified backup in `dir`. `artisan(args)` runs a command of the API and resolves its output.
 * Resolves { ok, file, name, report }; never throws for an ordinary failure.
 */
async function createBackup({ artisan, dir, kind, log }) {
  if (!folderWritable(dir)) {
    return { ok: false, error: 'The backup folder cannot be written to. Choose another folder.' };
  }
  const name = backupFileName(kind);
  const file = path.join(dir, name);
  let output;
  try {
    output = await artisan(['foodcourt:backup', file]);
  } catch (err) {
    output = err && err.output;
    log('ERROR', `Backup failed: ${String(err && err.message).slice(0, 400)}`);
  }
  const report = parseReport(output);
  if (!report || !report.ok) {
    fs.rmSync(file, { force: true });
    return { ok: false, error: (report && report.problems && report.problems[0]) || 'The backup could not be created.' };
  }
  log('INFO', `Backup created and verified: ${name} (${report.bytes} bytes, ${report.users} accounts)`);
  if (kind === 'auto') selectToPrune(fs.readdirSync(dir)).forEach((n) => fs.rmSync(path.join(dir, n), { force: true }));
  return { ok: true, file, name, report };
}

/** Opens `file` as a separate database through the API and reports whether it is usable. */
async function verifyBackup({ artisan, file }) {
  let output;
  try {
    output = await artisan(['foodcourt:backup', file, '--verify']);
  } catch (err) {
    output = err && err.output;
  }
  const report = parseReport(output);
  return report || { ok: false, problems: ['The file could not be checked.'] };
}

/** Swaps the database file for `source` after keeping the current one. Server must be stopped. Returns the safety copy. */
function swapDatabase({ dataDir, backupDir, source }) {
  const db = path.join(dataDir, 'foodcourt.sqlite');
  const safety = path.join(backupDir, backupFileName('before-restore'));
  if (fs.existsSync(db) && fs.statSync(db).size > 0) fs.copyFileSync(db, safety);
  ['-wal', '-shm', '-journal'].forEach((s) => fs.rmSync(db + s, { force: true }));
  const staged = db + '.restoring';
  fs.copyFileSync(source, staged);
  fs.renameSync(staged, db);
  return safety;
}

/** Puts the safety copy back (used when the restored database fails to start). */
function rollbackDatabase({ dataDir, safety }) {
  const db = path.join(dataDir, 'foodcourt.sqlite');
  ['-wal', '-shm', '-journal'].forEach((s) => fs.rmSync(db + s, { force: true }));
  if (fs.existsSync(safety)) fs.copyFileSync(safety, db);
}

/**
 * After a restore: carries this PC's session into the restored data so its PIN keeps working. `previous` is the safety
 * copy from swapDatabase. Resolves true only when the API confirms it; on any doubt the caller falls back to the password.
 */
async function keepSession({ artisan, previous, account, log }) {
  if (!account) return false;
  let output;
  try {
    output = await artisan(['foodcourt:keep-session', previous, `--user-id=${account.id}`, `--email=${account.email}`, `--role=${account.role}`]);
  } catch (err) {
    output = err && err.output;
  }
  const report = parseReport(output);
  if (report && report.kept === true) return true;
  log('INFO', `The saved sign-in does not fit the restored data (${(report && report.reason) || 'no answer'}); the password is required`);
  return false;
}

module.exports = {
  KEEP_AUTO,
  keepSession,
  backupFileName,
  selectToPrune,
  parseReport,
  autoBackupDue,
  folderWritable,
  listBackups,
  createBackup,
  verifyBackup,
  swapDatabase,
  rollbackDatabase,
};
