/**
 * Update folder layout, the active-release pointer, the journal and building a release folder (no Electron imports).
 *
 *   <root>/releases/<version>/{app,server,release.json,release.sig}   a complete, verified program version
 *   <root>/staging/                 a release being built; never run
 *   <root>/recovery/                recovery points (recovery.cjs)
 *   <root>/downloads/<version>/     manifest, signature, payload
 *   <root>/state/active.json        which release runs; absent means the installed files
 *   <root>/state/journal.json       the update in progress, written before each step
 *   <root>/state/outbox.jsonl       status reports waiting to reach the update service
 *
 * Client data is NOT here and is never moved: it stays in the data folder that the app has always used.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { compareVersions, manifestProblems, readJsonOr, readPayloadEntry, resolveInside, sha256Buffer, sha256File, verifySignature, writeFileDurable, writeJsonDurable } = require('./format.cjs');

const PRODUCT_FOLDER = 'MangalMurti POS Updates';

/** Environment for a process this app starts: without what the loader set for the release that happens to be running. */
function cleanEnv(env = process.env) {
  const out = { ...env };
  delete out.FOODCOURT_MANAGED_RELEASE;
  if (out.FOODCOURT_ORIGINAL_SERVER_DIR !== undefined) {
    if (out.FOODCOURT_ORIGINAL_SERVER_DIR) out.FOODCOURT_SERVER_DIR = out.FOODCOURT_ORIGINAL_SERVER_DIR;
    else delete out.FOODCOURT_SERVER_DIR;
    delete out.FOODCOURT_ORIGINAL_SERVER_DIR;
  }
  return out;
}

const KEEP_RELEASES = 2;

function defaultRoot() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, PRODUCT_FOLDER);
}

function layout(root) {
  return {
    root,
    releases: path.join(root, 'releases'),
    staging: path.join(root, 'staging'),
    recovery: path.join(root, 'recovery'),
    downloads: path.join(root, 'downloads'),
    state: path.join(root, 'state'),
    logs: path.join(root, 'logs'),
    active: path.join(root, 'state', 'active.json'),
    journal: path.join(root, 'state', 'journal.json'),
    outbox: path.join(root, 'state', 'outbox.jsonl'),
    history: path.join(root, 'state', 'history.jsonl'),
    device: path.join(root, 'state', 'device.json'),
    highest: path.join(root, 'state', 'highest-version.json'),
    snooze: path.join(root, 'state', 'snooze.json'),
    pending: path.join(root, 'state', 'pending.json'),
    policy: path.join(root, 'state', 'policy.json'),
    trustStatement: path.join(root, 'state', 'trust-statement.json'),
  };
}

const releaseDir = (dirs, version) => path.join(dirs.releases, version);

function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------------------------ pointer and journal
const readActive = (dirs) => readJsonOr(dirs.active);
const writeActive = (dirs, value) => writeJsonDurable(dirs.active, value);
const clearActive = (dirs) => fs.rmSync(dirs.active, { force: true });
const readJournal = (dirs) => readJsonOr(dirs.journal);
const writeJournal = (dirs, value) => writeJsonDurable(dirs.journal, { ...value, updated_at: new Date().toISOString() });
function closeJournal(dirs, journal, outcome) {
  appendLine(dirs.history, { ...journal, outcome, closed_at: new Date().toISOString() });
  fs.rmSync(dirs.journal, { force: true });
}

const highestVersion = (dirs) => readJsonOr(dirs.highest)?.version || null;
function recordHighestVersion(dirs, version) {
  const current = highestVersion(dirs);
  if (!current || compareVersions(version, current) > 0) writeJsonDurable(dirs.highest, { version });
}

// ------------------------------------------------------------------ where the running program's files are
/** Source of the current program: a release folder, or the installed files (`app` may be inside an asar). */
function currentSource({ dirs, installed }) {
  const active = readActive(dirs);
  if (active && active.version) {
    const dir = releaseDir(dirs, active.version);
    return { kind: 'release', version: active.version, app: path.join(dir, 'app'), server: path.join(dir, 'server') };
  }
  return { kind: 'installed', version: installed.version, app: installed.app, server: installed.server };
}

function sourcePathFor(source, relPath) {
  const [top, ...rest] = relPath.split('/');
  return path.join(top === 'app' ? source.app : source.server, ...rest);
}

/**
 * Verifies a signed manifest and its shape. Everything else trusts its result, so this is the only entry point for
 * manifest text. Returns { ok, manifest } or { ok:false, problem }.
 */
function loadManifest(raw, signature, keyId, trusted) {
  if (!trusted || Object.keys(trusted).length === 0) return { ok: false, problem: 'No trusted signing key is configured, so updates are disabled.' };
  if (!verifySignature(raw, signature, keyId, trusted)) return { ok: false, problem: 'The update signature is not valid.' };
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { ok: false, problem: 'The update description could not be read.' };
  }
  const problems = manifestProblems(manifest);
  if (problems.length) return { ok: false, problem: problems[0] };
  return { ok: true, manifest };
}

/**
 * Whether an incremental package can be applied to this install: every file that will be carried forward must be exactly
 * what the release expects. A modified or unknown install gets the full recovery package instead.
 * Returns { ok, mismatches: [] }.
 */
async function verifySource(manifest, source, limit = 20) {
  const inPackage = new Set(manifest.files.map((f) => f.path));
  const mismatches = [];
  for (const entry of manifest.tree) {
    if (inPackage.has(entry.path)) continue;
    const file = sourcePathFor(source, entry.path);
    let sha = null;
    try {
      sha = sha256Buffer(fs.readFileSync(file)); // asar-aware under Electron
    } catch {
      // missing
    }
    if (sha !== entry.sha256) {
      mismatches.push(entry.path);
      if (mismatches.length >= limit) break;
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Whole-package check: its size and SHA-256 against the signed manifest. */
async function verifyPayload(manifest, payloadFile) {
  if (!fs.existsSync(payloadFile)) return { ok: false, problem: 'The update package is missing.' };
  if (fs.statSync(payloadFile).size !== manifest.payload_size) return { ok: false, problem: 'The update package has the wrong size.' };
  if ((await sha256File(payloadFile)) !== manifest.payload_sha256) return { ok: false, problem: 'The update package failed its SHA-256 check.' };
  return { ok: true };
}

/**
 * Builds a complete release in staging and verifies every file, from the package plus (for an incremental package) the
 * current program's files. Nothing in use is touched. Throws with `.code = 'source_mismatch'` when a carried-forward
 * file is not what the release expects.
 */
async function buildStagedRelease({ dirs, manifest, rawManifest, signature, payloadFile, source, onProgress = () => undefined }) {
  const staged = path.join(dirs.staging, `${manifest.version}-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(staged, { recursive: true });
  const payloadFd = fs.openSync(payloadFile, 'r');
  try {
    const entries = new Map(manifest.files.map((f) => [f.path, f]));
    let done = 0;
    for (const entry of manifest.tree) {
      const target = resolveInside(staged, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const packed = entries.get(entry.path);
      let data;
      if (packed) {
        data = readPayloadEntry(payloadFd, packed);
      } else {
        try {
          data = fs.readFileSync(sourcePathFor(source, entry.path));
        } catch {
          data = null;
        }
        if (!data || sha256Buffer(data) !== entry.sha256) {
          const err = new Error(`This installation is not what the update expects (${entry.path}).`);
          err.code = 'source_mismatch';
          throw err;
        }
      }
      fs.writeFileSync(target, data);
      done += 1;
      if (done % 200 === 0) onProgress(done, manifest.tree.length);
    }
    writeFileDurable(path.join(staged, 'release.json'), rawManifest);
    writeFileDurable(path.join(staged, 'release.sig'), signature);

    // Read back what is really on disk: this catches a failing disk or a scanner quietly changing files
    const verified = await verifyInstalledTree(staged, manifest);
    if (!verified.ok) {
      const err = new Error(`A file did not verify after it was written (${verified.problem}).`);
      err.code = 'staging_verification';
      throw err;
    }
    return staged;
  } catch (err) {
    fs.closeSync(payloadFd);
    fs.rmSync(staged, { recursive: true, force: true, maxRetries: 3 });
    err.closed = true;
    throw err;
  } finally {
    try {
      fs.closeSync(payloadFd);
    } catch {
      // already closed on the failure path
    }
  }
}

async function verifyInstalledTree(dir, manifest, { only } = {}) {
  for (const entry of manifest.tree) {
    if (only && !entry.path.startsWith(only)) continue;
    const file = resolveInside(dir, entry.path);
    if (!fs.existsSync(file)) return { ok: false, problem: `missing ${entry.path}` };
    if (fs.statSync(file).size !== entry.size) return { ok: false, problem: `wrong size ${entry.path}` };
    if ((await sha256File(file)) !== entry.sha256) return { ok: false, problem: `changed ${entry.path}` };
  }
  return { ok: true };
}

const RENAME_RETRY_MS = 30000;

/**
 * Windows refuses to rename a folder while anything has a file in it open, and an antivirus or indexer looks at new files
 * briefly. That passes by itself, so it must not fail an update, which would then not be retried.
 */
function renameWithRetry(from, to, { rename = fs.renameSync, timeoutMs = RENAME_RETRY_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let wait = 100; ; wait = Math.min(wait * 2, 2000)) {
    try {
      return rename(from, to);
    } catch (err) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(err.code) || Date.now() >= deadline) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

/** Moves a verified staged release into place. An old folder of the same version from a failed try is set aside first. */
function promoteRelease(dirs, staged, version) {
  fs.mkdirSync(dirs.releases, { recursive: true });
  const target = releaseDir(dirs, version);
  if (fs.existsSync(target)) {
    const active = readActive(dirs);
    if (active && active.version === version) throw new Error('That release is the active one and cannot be replaced.');
    renameWithRetry(target, path.join(dirs.staging, `old-${version}-${randomBytes(4).toString('hex')}`));
  }
  renameWithRetry(staged, target);
  return target;
}

/**
 * What a start of the app must do, from the pointer and journal. Pure, so every crash point can be tested:
 *   { action: 'run', release: version|null, trial: bool }
 *   { action: 'recover', reason }       an update stopped part way; the bootstrapper must finish it safely
 *   { action: 'blocked', message }      a person must look at this before the app starts
 */
const MAX_TRIAL_BOOTS = 2;
function decideBoot({ journal, active, installedVersion }) {
  if (journal && journal.phase === 'NEEDS_DEVELOPER') {
    return { action: 'blocked', message: journal.message || 'An update could not be finished safely. Your data has been left untouched. Contact support before using the application.' };
  }
  if (journal && journal.phase && !['TRIAL', 'DONE'].includes(journal.phase)) return { action: 'recover', reason: `interrupted at ${journal.phase}` };
  if (active && active.state === 'trial') {
    if ((active.boot_attempts || 0) >= MAX_TRIAL_BOOTS) return { action: 'recover', reason: 'the new version did not confirm that it started' };
    return { action: 'run', release: active.version, trial: true };
  }
  // A newer installer has been run over this release: the installed files win, or the installer would change nothing
  if (active?.version && installedVersion && compareVersions(installedVersion, active.version) > 0) {
    return { action: 'run', release: null, trial: false, clearActive: true };
  }
  return { action: 'run', release: active?.version || null, trial: false };
}

/**
 * Verifies an active release before running it: signature, that it was built for this Electron, and every file of the
 * desktop program (not the large server tree). `electronMajor` is left out only by callers that do not start the release.
 */
async function verifyReleaseForBoot(dirs, version, trusted, electronMajor) {
  const dir = releaseDir(dirs, version);
  try {
    const raw = fs.readFileSync(path.join(dir, 'release.json'), 'utf8');
    const signature = fs.readFileSync(path.join(dir, 'release.sig'), 'utf8').trim();
    const keyId = JSON.parse(raw).signing?.key_id;
    const loaded = loadManifest(raw, signature, keyId, trusted);
    if (!loaded.ok) return { ok: false, problem: loaded.problem };
    if (loaded.manifest.version !== version) return { ok: false, problem: 'The release folder holds another version.' };
    const built = loaded.manifest.compatibility?.electron_major;
    if (electronMajor && built && built !== electronMajor) return { ok: false, problem: `This release was built for Electron ${built}, and the installed program runs ${electronMajor}.` };
    const tree = await verifyInstalledTree(dir, loaded.manifest, { only: 'app/' });
    if (!tree.ok) return { ok: false, problem: tree.problem };
    return { ok: true, manifest: loaded.manifest, dir };
  } catch (err) {
    return { ok: false, problem: err.message };
  }
}

/** Keeps the active release, its fallback and the newest others. Never touches anything else. */
function pruneReleases(dirs, keep = KEEP_RELEASES) {
  const active = readActive(dirs);
  const protectedVersions = new Set([active?.version, active?.previous?.version].filter(Boolean));
  let names = [];
  try {
    names = fs.readdirSync(dirs.releases);
  } catch {
    return [];
  }
  const removable = names.filter((n) => !protectedVersions.has(n)).sort(compareVersions);
  const excess = Math.max(0, names.length - keep);
  const removed = removable.slice(0, excess);
  removed.forEach((n) => fs.rmSync(releaseDir(dirs, n), { recursive: true, force: true, maxRetries: 3 }));
  return removed;
}

function clearStaging(dirs) {
  fs.rmSync(dirs.staging, { recursive: true, force: true, maxRetries: 3 });
  fs.mkdirSync(dirs.staging, { recursive: true });
}

module.exports = {
  cleanEnv,
  PRODUCT_FOLDER,
  KEEP_RELEASES,
  MAX_TRIAL_BOOTS,
  defaultRoot,
  layout,
  releaseDir,
  appendLine,
  readActive,
  writeActive,
  clearActive,
  readJournal,
  writeJournal,
  closeJournal,
  highestVersion,
  recordHighestVersion,
  currentSource,
  sourcePathFor,
  loadManifest,
  verifySource,
  verifyPayload,
  buildStagedRelease,
  verifyInstalledTree,
  promoteRelease,
  renameWithRetry,
  decideBoot,
  verifyReleaseForBoot,
  pruneReleases,
  clearStaging,
};
