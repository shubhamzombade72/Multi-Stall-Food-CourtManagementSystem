/**
 * The installed app's entry point. It decides which program files run, then gets out of the way:
 *
 *   - the update bootstrapper, when started with --fc-bootstrap=<job file>
 *   - recovery, when an earlier update stopped part way or a new version failed to confirm it started
 *   - the active release from <update root>/releases/<version>, once its signature and desktop files verify
 *   - otherwise the installed files, exactly as before updates existed
 *
 * Trust comes from update-trust.json of the INSTALLED files, never from a release folder. In an unpackaged run (developers,
 * automated tests) updates stay out of the way unless FOODCOURT_UPDATE_ROOT is set; those test settings have no effect in
 * an installed app. No client data is read or written here.
 */
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.FOODCOURT_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.FOODCOURT_USER_DATA_DIR));

const rel = require('./update/releases.cjs');
const { writeJsonDurable } = require('./update/format.cjs');

const packaged = app.isPackaged;
const testRoot = !packaged ? process.env.FOODCOURT_UPDATE_ROOT : '';
const updatesActive = packaged || Boolean(testRoot);
const root = testRoot ? path.resolve(testRoot) : rel.defaultRoot();
const dirs = rel.layout(root);

function loadTrust() {
  const file = !packaged && process.env.FOODCOURT_UPDATE_TRUST ? process.env.FOODCOURT_UPDATE_TRUST : path.join(__dirname, 'update-trust.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).keys || {};
  } catch {
    return {};
  }
}

const installed = () => ({
  version: app.getVersion(),
  app: path.join(__dirname, '..'),
  server: process.env.FOODCOURT_SERVER_DIR || (packaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..', 'build-server')),
});

const dataDir = () => process.env.FOODCOURT_DATA_DIR || path.join(app.getPath('userData'), 'server');

function fileLog(level, message) {
  if (!updatesActive) return; // a developer run leaves nothing in the real updates folder
  try {
    fs.mkdirSync(dirs.logs, { recursive: true });
    fs.appendFileSync(path.join(dirs.logs, 'update.log'), `${JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, level, msg: String(message).slice(0, 2000) })}\n`);
  } catch {
    // logging must never stop an update
  }
}

/** Arguments that restart this same app, whether installed (none) or run by `electron <path>` (the path). */
const relaunchArgs = () => (packaged ? [] : [app.getAppPath()]);

function restartApp() {
  const child = spawn(process.execPath, relaunchArgs(), { detached: true, stdio: 'ignore', env: rel.cleanEnv(), windowsHide: false });
  child.unref();
}

// ------------------------------------------------------------------ progress window (bootstrapper and recovery)
const PROGRESS_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>Updating</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#f1f5f9;font:15px Segoe UI,sans-serif}
main{width:420px;text-align:center}h1{font-size:18px;font-weight:600;margin:0 0 12px}p{margin:0;color:#94a3b8;line-height:1.5}</style></head>
<body><main><h1 id="t">Updating the application</h1><p id="m">Please do not turn off this computer.</p></main></body></html>`)}`;

function progressWindow() {
  const win = new BrowserWindow({ width: 520, height: 220, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true, title: 'Updating', backgroundColor: '#0f172a', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.on('close', (e) => e.preventDefault()); // closing must not interrupt an update
  win.loadURL(PROGRESS_PAGE).catch(() => undefined);
  return {
    show(title, message) {
      if (win.isDestroyed()) return;
      win.webContents.executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(title)};document.getElementById('m').textContent=${JSON.stringify(message || 'Please do not turn off this computer.')};`).catch(() => undefined);
    },
    destroy() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

const STATUS_TEXT = {
  VERIFYING: 'Checking the update…',
  BACKUP_IN_PROGRESS: 'Backing up your data…',
  MIGRATING: 'Updating the database…',
  INSTALLING: 'Installing the new version…',
  HEALTH_CHECK: 'Checking the new version…',
  FAILED: 'The update stopped. Restoring the previous version…',
  RECOVERY_IN_PROGRESS: 'Restoring the previous version…',
  RECOVERED: 'The previous version has been restored.',
};

function makeBootstrap(window) {
  const { createBootstrap } = require('./update/bootstrap.cjs');
  return createBootstrap({
    dirs,
    dataDir: dataDir(),
    userData: app.getPath('userData'),
    installed: installed(),
    trusted: loadTrust(),
    log: fileLog,
    onStatus: (status) => window.show(STATUS_TEXT[status] || 'Updating the application', ''),
  });
}

/** Waits for the app that started us: both of us need the same single-instance lock. */
async function takeLock(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.requestSingleInstanceLock()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function rememberResult(result, version) {
  writeJsonDurable(path.join(dirs.state, 'last-result.json'), result.ok
    ? { outcome: 'installed', version, at: new Date().toISOString() }
    : { outcome: result.needs_developer ? 'needs_developer' : 'recovered', version, failure: result.failure || result.reason || null, restored_database: Boolean(result.restored_database), running_version: result.running_version || null, at: new Date().toISOString() });
}

async function runBootstrapper(jobFile) {
  await app.whenReady();
  const window = progressWindow();
  fileLog('INFO', `Bootstrapper started for ${jobFile}`);
  const finish = (code) => {
    window.destroy();
    restartApp();
    app.exit(code);
  };
  try {
    const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    if (!(await takeLock())) {
      fileLog('ERROR', 'The application did not close, so the update was not started');
      return finish(1);
    }
    const result = await makeBootstrap(window).run(job);
    rememberResult(result, job.version);
    fs.rmSync(jobFile, { force: true });
    if (process.env.FOODCOURT_UPDATE_NO_RESTART === '1' && !packaged) {
      window.destroy();
      return app.exit(result.ok ? 0 : 3);
    }
    return finish(result.ok ? 0 : 3);
  } catch (err) {
    fileLog('ERROR', `Bootstrapper error: ${err.stack || err}`);
    return finish(1);
  }
}

async function runRecovery(reason) {
  await app.whenReady();
  const window = progressWindow();
  fileLog('WARN', `Recovery on start: ${reason}`);
  const journal = rel.readJournal(dirs);
  try {
    if (!journal) {
      // A trial pointer with no journal: nothing about the database is known to have changed, so only the pointer moves
      const active = rel.readActive(dirs);
      if (active && active.previous && active.previous.kind === 'release') rel.writeActive(dirs, { version: active.previous.version, state: 'confirmed' });
      else rel.clearActive(dirs);
    } else {
      const result = await makeBootstrap(window).recover({ ...journal, recovery_reason: reason });
      rememberResult(result, journal.version);
    }
  } catch (err) {
    fileLog('ERROR', `Recovery error: ${err.stack || err}`);
  }
  window.destroy();
  if (process.env.FOODCOURT_UPDATE_NO_RESTART !== '1' || packaged) restartApp();
  app.exit(0);
}

function runBlocked(message) {
  app.whenReady().then(() => {
    fileLog('ERROR', 'Start refused: the last update needs a developer');
    dialog.showErrorBox('The application cannot start', message);
    app.exit(2);
  });
}

function runProgram(release) {
  fileLog('INFO', `Program running: ${release ? release.manifest.version : 'installed files'}`);
  if (release) {
    app.setVersion(release.manifest.version);
    process.env.FOODCOURT_ORIGINAL_SERVER_DIR = process.env.FOODCOURT_SERVER_DIR || '';
    process.env.FOODCOURT_SERVER_DIR = path.join(release.dir, 'server');
    process.env.FOODCOURT_MANAGED_RELEASE = '1';
    require(path.join(release.dir, 'app', 'electron', 'main.cjs'));
  } else {
    require('./main.cjs');
  }
}

// ------------------------------------------------------------------ start
async function start() {
  const bootstrapArg = process.argv.find((a) => a.startsWith('--fc-bootstrap='));
  if (bootstrapArg && updatesActive) return runBootstrapper(bootstrapArg.slice('--fc-bootstrap='.length));

  const supportCommand = process.argv.some((a) => a.startsWith('--diagnose-login='));
  if (!updatesActive || supportCommand) return runProgram(null);

  // Another instance, or a running bootstrapper, owns everything below
  if (!app.requestSingleInstanceLock()) return app.quit();

  const decision = rel.decideBoot({ journal: rel.readJournal(dirs), active: rel.readActive(dirs) });
  if (decision.action === 'blocked') return runBlocked(decision.message);
  if (decision.action === 'recover') return runRecovery(decision.reason);
  if (!decision.release) return runProgram(null);

  const verified = await rel.verifyReleaseForBoot(dirs, decision.release, loadTrust());
  if (!verified.ok) {
    fileLog('ERROR', `Release ${decision.release} failed verification: ${verified.problem}`);
    if (decision.trial) return runRecovery(`the new version failed verification: ${verified.problem}`);
    // A confirmed release changed on disk: the installed files are known good, and the database stays compatible unless a
    // destructive release set a minimum version, in which case the built-in check refuses to start and says so
    const active = rel.readActive(dirs);
    if (active?.previous?.kind === 'release') rel.writeActive(dirs, { version: active.previous.version, state: 'confirmed' });
    else rel.clearActive(dirs);
    return runProgram(null);
  }

  if (decision.trial) {
    const active = rel.readActive(dirs);
    rel.writeActive(dirs, { ...active, boot_attempts: (active.boot_attempts || 0) + 1 });
  }
  return runProgram(verified);
}

start().catch((err) => {
  fileLog('ERROR', `Loader error: ${err.stack || err}`);
  runProgram(null);
});
