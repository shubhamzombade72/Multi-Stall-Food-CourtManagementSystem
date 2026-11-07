/**
 * FoodCourt Desktop - Electron main process.
 *
 * Security model:
 *  - Renderer runs with contextIsolation, sandbox and no Node integration.
 *  - The renderer reaches the main process only through the allowlisted IPC channels below, and every
 *    handler checks that the call comes from the app's own page.
 *  - Nobody types a server address. By default the app starts a built-in server on 127.0.0.1
 *    (electron/embedded-server.cjs). A PC that belongs to a multi-PC food court is paired to its host with a
 *    one-time code (electron/pairing.cjs); the device token is kept encrypted by Windows (safeStorage) and
 *    attached to host requests here in the main process, so the renderer never sees it.
 *  - The app holds no database credentials; all data access goes through the authenticated Laravel API.
 *  - Navigation away from the app, new windows and web permission requests (camera, mic, geolocation...)
 *    are refused.
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, net, powerMonitor, safeStorage, session, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeApiUrl, classifyNetworkError, parseBundledConfig, shouldUseSavedAddress } = require('./config.cjs');
const { artisanFor, locateRuntime, startEmbeddedServer, FAILURE } = require('./embedded-server.cjs');
const backup = require('./backup.cjs');
const pairing = require('./pairing.cjs');
const { createAuthVault } = require('./auth-vault.cjs');
const { createPrinting } = require('./printing/index.cjs');
const { createUpdates } = require('./update/wiring.cjs');

const DEV_URL = process.env.ELECTRON_START_URL || ''; // e.g. http://localhost:3000 for `pnpm dev`

// Automated tests run the app against a throw-away profile so they never touch a real install's settings
if (process.env.FOODCOURT_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.FOODCOURT_USER_DATA_DIR));
}
const MAX_LOG_BYTES = 2 * 1024 * 1024;

// ------------------------------------------------------------------ files
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const bundledConfigPath = () => path.join(__dirname, 'app-config.json');
const logPath = () => path.join(app.getPath('userData'), 'logs', 'desktop.log');
const pairingPath = () => path.join(app.getPath('userData'), 'pairing.json');
const settingsPath = () => path.join(app.getPath('userData'), 'desktop-settings.json');

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file); // atomic replace: a crash never leaves a half-written file
}

/** One JSON object per line: easy to search, easy to hand to support. Never contains passwords or tokens. */
function log(level, message, component = 'main') {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, file + '.1');
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), level, component, msg: String(message).replace(/[\r\n]+/g, ' ').slice(0, 2000) });
    fs.appendFileSync(file, line + '\n', 'utf8');
  } catch {
    // logging must never crash the app
  }
}
const serverLog = (level, message) => log(level, message, 'server');

// ------------------------------------------------------------------ which server this PC uses
/**
 * Order of precedence for a shared-host (multi-PC) address:
 *   1. the host this PC was paired with (userData/config.json, written by pairing)
 *   2. FOODCOURT_API_URL (development / automated tests)
 *   3. electron/app-config.json, set by the release engineer for a pre-configured installer
 * With none of these the app starts its own built-in server. There is no built-in default address.
 */
let ignoredLegacyLogged = false;
function readConfig() {
  let saved = null;
  try {
    saved = normalizeApiUrl(JSON.parse(fs.readFileSync(configPath(), 'utf8')).apiBaseUrl);
  } catch {
    // no / unreadable config file: fall through to the other sources
  }
  if (saved && shouldUseSavedAddress(saved, fs.existsSync(pairingPath()))) return { apiBaseUrl: saved, source: 'paired' };
  if (saved && !ignoredLegacyLogged) {
    ignoredLegacyLogged = true;
    log('WARN', 'Ignoring an old saved address that pointed at this computer; using the built-in database');
  }
  const fromEnv = normalizeApiUrl(process.env.FOODCOURT_API_URL);
  if (fromEnv) return { apiBaseUrl: fromEnv, source: 'environment' };
  let bundled = null;
  try {
    bundled = parseBundledConfig(fs.readFileSync(bundledConfigPath(), 'utf8'));
  } catch {
    // missing bundled config
  }
  if (bundled) return { apiBaseUrl: bundled, source: 'release' };
  return { apiBaseUrl: null, source: 'none' };
}

// ------------------------------------------------------------------ device sign-in (PIN)
let authVaultInstance = null;

const authVault = () => {
  if (!authVaultInstance) {
    authVaultInstance = createAuthVault({
      file: path.join(app.getPath('userData'), 'auth-vault.json'),
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      seal: (text) => safeStorage.encryptString(text),
      unseal: (data) => safeStorage.decryptString(data),
      log: (level, message) => log(level, message, 'auth'),
    });
  }
  return authVaultInstance;
};

// Older automated journeys sign in directly. Honoured only in an unpackaged run, so an installed app cannot be
// started without the PIN lock. It also never releases a saved session: it only leaves the vault unused.
const pinLockOff = () => !app.isPackaged && process.env.FOODCOURT_PIN_LOCK === 'off';

/** The data this PC talks to changed, so a saved session is meaningless now. Sign in again. */
const forgetSavedSignIn = () => authVault().clear().catch((err) => log('ERROR', `Could not remove the saved sign-in: ${err.code || 'unknown error'}`));

// ------------------------------------------------------------------ pairing (multi-PC)
let pairingCache; // undefined = not read yet; null = not paired

function readPairing() {
  if (pairingCache !== undefined) return pairingCache;
  pairingCache = null;
  try {
    const raw = JSON.parse(fs.readFileSync(pairingPath(), 'utf8'));
    const apiBaseUrl = normalizeApiUrl(raw.apiBaseUrl);
    if (apiBaseUrl && raw.tokenEnc && safeStorage.isEncryptionAvailable()) {
      pairingCache = { apiBaseUrl, token: safeStorage.decryptString(Buffer.from(raw.tokenEnc, 'base64')), foodCourtName: raw.foodCourtName || '' };
    }
  } catch {
    // not paired, or the token cannot be decrypted on this Windows account: treated as not paired
  }
  return pairingCache;
}

function clearPairing() {
  pairingCache = null;
  fs.rmSync(pairingPath(), { force: true });
  writeJsonAtomic(configPath(), {});
}

async function pairWithHost(pairingString) {
  const decoded = pairing.decodePairingString(pairingString);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  const safety = pairing.hostIsSafe(decoded.url);
  if (!safety.ok) return { ok: false, error: safety.error };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Windows cannot protect the connection key on this account. Sign in to Windows with a normal user account and try again.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await net.fetch(`${decoded.url}/pairing/redeem`, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: decoded.code, device_name: os.hostname().slice(0, 100) }),
    });
  } catch (err) {
    const net_ = classifyNetworkError(controller.signal.aborted ? 'timeout' : String(err && err.message));
    log('WARN', `Pairing: host not reachable (${net_.code})`);
    return { ok: false, error: 'This computer cannot reach the food court host. Check that you are on the food court network and that the host computer is on.' };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    log('WARN', `Pairing refused (HTTP ${res.status})`);
    return { ok: false, error: pairing.describeRedeemFailure(res.status) };
  }
  const body = await res.json().catch(() => null);
  const token = body && body.data && body.data.device_token;
  if (typeof token !== 'string' || token.length < 20) return { ok: false, error: 'The host answered in an unexpected way. Contact your administrator.' };

  writeJsonAtomic(pairingPath(), {
    apiBaseUrl: decoded.url,
    tokenEnc: safeStorage.encryptString(token).toString('base64'),
    foodCourtName: String(body.data.food_court_name || '').slice(0, 100),
    pairedAt: new Date().toISOString(),
  });
  writeJsonAtomic(configPath(), { apiBaseUrl: decoded.url });
  pairingCache = undefined;
  await forgetSavedSignIn();
  await shutdownServer(); // this PC now uses the shared host; the built-in server is not needed
  log('INFO', `This computer was connected to the food court host "${body.data.food_court_name}"`);
  return { ok: true, foodCourtName: body.data.food_court_name || '' };
}

// ------------------------------------------------------------------ built-in server (single-PC mode)
const serverDir = () =>
  process.env.FOODCOURT_SERVER_DIR || (app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..', 'build-server'));
const dataDir = () => process.env.FOODCOURT_DATA_DIR || path.join(app.getPath('userData'), 'server');

let embedded = null; // { url, port, status, artisan, stop } once running
let embeddedStart = null; // in-flight / finished start; reset on failure so "retry" starts again
let startup = { phase: 'starting', message: 'Starting application…' };

function setStartup(status) {
  startup = status;
}

function startBuiltInServer() {
  if (embeddedStart) return embeddedStart;
  const runtime = locateRuntime(serverDir());
  if (!runtime) {
    setStartup({ phase: 'failed', code: 'runtime_missing', message: FAILURE.runtime_missing });
    log('ERROR', 'Built-in server files not found next to the application');
    return (embeddedStart = Promise.resolve(null));
  }
  setStartup({ phase: 'starting', message: 'Starting application…' });
  embeddedStart = startEmbeddedServer({ runtime, dataDir: dataDir(), version: app.getVersion(), log: serverLog, onStatus: setStartup })
    .then((server) => {
      embedded = server;
      scheduleBackups();
      return server;
    })
    .catch(() => {
      embeddedStart = null; // the status already says why; "Try again" starts anew
      return null;
    });
  return embeddedStart;
}

async function shutdownServer() {
  const server = embedded;
  embedded = null;
  embeddedStart = null;
  try {
    if (server) await server.stop();
  } catch {
    // already stopped
  }
}

/** The server this run talks to: a paired/configured shared host, otherwise the built-in server. */
async function resolveConfig() {
  const remote = readConfig();
  const paired = readPairing();
  if (remote.apiBaseUrl) {
    return { ...remote, mode: 'remote', error: null, paired: Boolean(paired && paired.apiBaseUrl === remote.apiBaseUrl), foodCourtName: paired?.foodCourtName || '' };
  }
  const server = await startBuiltInServer();
  if (server) return { apiBaseUrl: server.url, source: 'embedded', mode: 'embedded', error: null, paired: false, foodCourtName: '' };
  return { apiBaseUrl: null, source: 'none', mode: 'none', error: startup.phase === 'failed' ? startup.message : FAILURE.not_ready, paired: false, foodCourtName: '' };
}

const PROBE_TIMEOUT_MS = 8000;

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, json };
  } catch (err) {
    return { error: controller.signal.aborted ? 'timeout' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** What the startup screen shows. Built-in server: its lifecycle phase. Paired host: a live reachability check. */
async function getStartupStatus() {
  const remote = readConfig();
  if (!remote.apiBaseUrl) return startup;
  const base = remote.apiBaseUrl.replace(/\/api$/, '');
  const up = await probe(`${base}/up`);
  if (up.status === 200) return { phase: 'ready', message: 'Application ready.', mode: 'remote' };
  const kind = up.error ? classifyNetworkError(up.error).code : `http_${up.status}`;
  log('WARN', `Food court host not reachable (${kind})`);
  return {
    phase: 'host_unreachable',
    mode: 'remote',
    message: 'This computer cannot reach the food court host. Check that you are on the food court network and that the host computer is switched on.',
  };
}

// ------------------------------------------------------------------ backups (single-PC database)
const readSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {};
  } catch {
    return {};
  }
};
const saveSettings = (patch) => writeJsonAtomic(settingsPath(), { ...readSettings(), ...patch });
const backupDir = () => readSettings().backupDir || path.join(dataDir(), 'backups');

let backupBusy = false;
let restoreBusy = false;

async function runBackup(kind) {
  if (!embedded) return { ok: false, error: 'The application is not running.' };
  if (backupBusy) return { ok: false, error: 'A backup is already running.' };
  backupBusy = true;
  try {
    const result = await backup.createBackup({ artisan: embedded.artisan, dir: backupDir(), kind, log: serverLog });
    if (result.ok) saveSettings({ lastBackupAt: new Date().toISOString(), lastBackupError: null });
    else saveSettings({ lastBackupError: { at: new Date().toISOString(), message: result.error } });
    if (!result.ok) log('ERROR', `Backup (${kind}) failed: ${result.error}`);
    return result.ok ? { ok: true, name: result.name } : { ok: false, error: result.error };
  } finally {
    backupBusy = false;
  }
}

let backupTimer = null;
function scheduleBackups() {
  if (backupTimer) return;
  const tick = () => {
    if (embedded && backup.autoBackupDue(readSettings().lastBackupAt)) runBackup('auto').catch(() => undefined);
  };
  const firstDelay = Number(process.env.FOODCOURT_FIRST_BACKUP_DELAY_MS) || 2 * 60 * 1000; // test hook; not while the app is still settling
  setTimeout(tick, firstDelay).unref();
  backupTimer = setInterval(tick, 60 * 60 * 1000);
  backupTimer.unref();
}

function backupStatus() {
  const s = readSettings();
  return {
    available: Boolean(embedded) || Boolean(locateRuntime(serverDir())),
    directory: backupDir(),
    customDirectory: Boolean(s.backupDir),
    lastBackupAt: s.lastBackupAt || null,
    lastError: s.lastBackupError || null,
    backups: backup.listBackups(backupDir()).slice(0, 40),
  };
}

/** Restore a backup: verify it first, keep the current data, swap, restart, and roll back if it will not start. */
async function restoreBackup(win, name) {
  const runtime = locateRuntime(serverDir());
  if (!runtime || readConfig().apiBaseUrl) return { ok: false, error: 'Restoring is only available on a computer that runs its own database.' };

  let source;
  if (name) {
    if (path.basename(name) !== name || !/^foodcourt-.*\.sqlite$/.test(name)) return { ok: false, error: 'Unknown backup.' };
    source = path.join(backupDir(), name);
  } else {
    const picked = await dialog.showOpenDialog(win, { title: 'Choose a backup to restore', properties: ['openFile'], filters: [{ name: 'Food Court backup', extensions: ['sqlite'] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    source = picked.filePaths[0];
  }
  if (!fs.existsSync(source)) return { ok: false, error: 'That backup file was not found.' };

  const artisan = embedded ? embedded.artisan : artisanFor(runtime, dataDir());
  const report = await backup.verifyBackup({ artisan, file: source });
  if (!report.ok) return { ok: false, error: `This backup cannot be used: ${(report.problems || ['it failed the check'])[0]}` };

  const choice = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Restore backup',
    message: 'Replace the current data with this backup?',
    detail: `Everything entered after the backup was made (${report.users ?? '?'} accounts in the backup) will no longer be visible. A copy of the current data is kept first, so this can be undone by an administrator.`,
    buttons: ['Cancel', 'Restore backup'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (choice.response !== 1) return { ok: false, cancelled: true };

  await shutdownServer();
  let safety;
  try {
    safety = backup.swapDatabase({ dataDir: dataDir(), backupDir: backupDir(), source });
  } catch (err) {
    log('ERROR', `Restore could not replace the database: ${err.message}`);
    startBuiltInServer();
    return { ok: false, error: 'The data could not be replaced. Nothing was changed.' };
  }
  log('INFO', `Backup restored from ${path.basename(source)}; previous data kept as ${path.basename(safety)}`);
  const started = await startBuiltInServer();
  if (!started) {
    log('ERROR', 'Restored database did not start; rolling back');
    backup.rollbackDatabase({ dataDir: dataDir(), safety });
    await startBuiltInServer();
    return { ok: false, error: 'The restored data would not start, so the previous data was put back.' };
  }
  // Same person on the same PC: the PIN keeps working. Done now because the server has upgraded the restored data.
  const vault = pinLockOff() ? null : await authVault().status().catch(() => null);
  const kept = await backup.keepSession({ artisan: started.artisan, previous: safety, account: vault && vault.account, log });
  if (!kept) await forgetSavedSignIn();
  return { ok: true };
}

// ------------------------------------------------------------------ diagnostics (for support)
function tailLog(lines = 80) {
  try {
    const all = fs.readFileSync(logPath(), 'utf8').split('\n').filter(Boolean);
    return all.slice(-lines);
  } catch {
    return [];
  }
}

async function collectDiagnostics() {
  const cfg = readConfig();
  const embeddedUrl = embedded ? embedded.url : null;
  const apiBase = cfg.apiBaseUrl || embeddedUrl;
  let ready = null;
  if (apiBase) {
    const r = await probe(`${apiBase}/system/ready`);
    ready = r.error ? { reachable: false, reason: classifyNetworkError(r.error).code } : { reachable: true, httpStatus: r.status, report: r.json && r.json.data };
  }
  return {
    app: { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged, platform: `${process.platform} ${os.release()}` },
    mode: cfg.apiBaseUrl ? 'shared host' : 'this computer',
    startup,
    apiBase,
    readiness: ready,
    paths: { log: logPath(), data: cfg.apiBaseUrl ? null : dataDir(), backups: cfg.apiBaseUrl ? null : backupDir() },
    recentLog: tailLog(60),
  };
}

// ------------------------------------------------------------------ window
let mainWindow = null;

function isAppUrl(url) {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'मंगलमूर्ती POS',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // Order/ticket sounds fire from polling, not from a click; without this Chromium would mute them until the
      // first tap. This only relaxes media autoplay; it grants no other capability.
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => {
    log('INFO', 'ready-to-show fired, showing window');
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    log('INFO', 'did-finish-load fired');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) {
        log('INFO', 'showing window from did-finish-load');
        mainWindow.show();
      }
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    log('ERROR', `Renderer did-fail-load: ${errorCode} ${errorDescription}`);
  });
  mainWindow.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    log('INFO', `[renderer-console] ${message} (${sourceId}:${line})`);
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log('WARN', 'Window not visible after 2s, forcing show');
      mainWindow.show();
    }
  }, 2000);

  // No pop-up windows; external links open in the system browser only if http(s)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      log('WARN', `Blocked navigation to ${url}`);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => log('ERROR', `Renderer gone: ${details.reason}`));

  if (process.env.FOODCOURT_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', () => runSmokeTest(mainWindow));
  }

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

/**
 * Startup + security self-check, only when FOODCOURT_SMOKE_TEST=1 (used by CI / release verification).
 * Prints one JSON line to stdout and exits with 0 (all checks pass) or 1.
 */
async function runSmokeTest(win) {
  const prefs = win.webContents.getLastWebPreferences() || {};
  let renderer = {};
  try {
    await new Promise((r) => setTimeout(r, 2500)); // let React mount
    // Informational: can the packaged page (file:// origin) reach the configured API, including a
    // CORS-preflighted request with an Authorization header? Expected: health 200, bogus token 401.
    const resolved = await resolveConfig();
    const api = resolved.apiBaseUrl;
    renderer.mode = resolved.mode;
    renderer.api = !api ? { base: null, note: 'no server available' } : await win.webContents.executeJavaScript(`(async () => {
      const base = ${JSON.stringify(api)};
      const probe = async (url, init) => { try { return (await fetch(url, init)).status; } catch (e) { return 'error: ' + e.message; } };
      return {
        base,
        health: await probe(base.replace(/\\/api$/, '') + '/up'),
        ready: await probe(base + '/system/ready'),
        authPreflight: await probe(base + '/auth/me', { headers: { Accept: 'application/json', Authorization: 'Bearer smoke-test-invalid' } }),
      };
    })()`);
    renderer = { ...renderer, ...(await win.webContents.executeJavaScript(`({
      nodeRequire: typeof require,
      nodeProcess: typeof process,
      bridgeKeys: Object.keys(window.desktop || {}).sort(),
      csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null,
      title: document.title,
      appRendered: document.getElementById('root') ? document.getElementById('root').children.length > 0 : false,
      route: location.hash,
      bodyText: document.body.innerText.slice(0, 160),
    })`)) };
  } catch (err) {
    renderer = { error: String(err) };
  }
  // DevTools must be impossible to open in an installed app: try, and see
  let devToolsOff = true;
  if (app.isPackaged) {
    win.webContents.openDevTools();
    await new Promise((r) => setTimeout(r, 500));
    devToolsOff = !win.webContents.isDevToolsOpened();
    if (!devToolsOff) win.webContents.closeDevTools();
  }
  const result = {
    contextIsolation: prefs.contextIsolation === true,
    nodeIntegration: prefs.nodeIntegration === false,
    sandbox: prefs.sandbox === true,
    webSecurity: prefs.webSecurity !== false,
    devToolsOff,
    rendererHasNoRequire: renderer.nodeRequire === 'undefined',
    rendererHasNoProcess: renderer.nodeProcess === 'undefined',
    bridgeAllowlist: JSON.stringify(renderer.bridgeKeys) === JSON.stringify(BRIDGE_KEYS),
    noAddressEntry: !(renderer.bridgeKeys || []).some((k) => /ApiBaseUrl|testConnection/i.test(k)),
    cspPresent: typeof renderer.csp === 'string' && renderer.csp.includes("script-src 'self'"),
    appRendered: renderer.appRendered === true,
    route: renderer.route,
    version: app.getVersion(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
    configFile: configPath(),
    api: renderer.api, // informational, not part of pass/fail: depends on a server being up
  };
  const pass = ['contextIsolation', 'nodeIntegration', 'sandbox', 'webSecurity', 'devToolsOff', 'rendererHasNoRequire', 'rendererHasNoProcess', 'bridgeAllowlist', 'noAddressEntry', 'cspPresent', 'appRendered']
    .every((k) => result[k] === true);
  process.stdout.write(`SMOKE_RESULT ${JSON.stringify({ pass, ...result, renderer })}\n`);
  log('INFO', `Smoke test ${pass ? 'PASSED' : 'FAILED'}`);
  await shutdownServer();
  app.exit(pass ? 0 : 1);
}

function buildMenu() {
  const template = [
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen', accelerator: 'F11' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ IPC (allowlist)
// Keep in sync with preload.cjs and the smoke test: this is the renderer's entire reach into the main process.
const BRIDGE_KEYS = [
  'authVaultClear', 'authVaultSetup', 'authVaultStatus', 'authVaultUnlock', 'backupNow', 'chooseBackupFolder', 'connectToHost', 'enqueuePrintJob', 'getAppInfo', 'getBackupStatus', 'getConfig', 'getDiagnostics', 'getPrintConfig',
  'getPrinterStatus', 'getStartupStatus', 'listPrintJobs', 'listPrinters', 'log', 'onPrintJobsChanged', 'previewPrintDocument', 'print', 'reprintPrintJob',
  'restoreBackup', 'retryPrintJob', 'retryStart', 'sendTestPrint', 'setPrintConfig', 'updateApprove', 'updateCheck', 'updateEnroll', 'updateGetState', 'updateInstallFromFolder', 'updateNow', 'updatePauseDownload', 'updateRemindLater', 'updateReportActivity', 'updateSetPolicy', 'useBuiltInServer',
].sort();

/** Installing and changing update rules are owner tasks. The server says who holds this token, not the renderer. */
async function isOwnerToken(token) {
  if (typeof token !== 'string' || !token || token.length > 500) return false;
  try {
    const cfg = await resolveConfig();
    if (!cfg.apiBaseUrl) return false;
    const res = await net.fetch(`${cfg.apiBaseUrl}/auth/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, redirect: 'error' });
    if (!res.ok) return false;
    return (await res.json())?.data?.user?.role === 'owner';
  } catch {
    return false;
  }
}

let updates = null; // software updates (electron/update), created once the app is ready
let printing = null; // thermal printing service (electron/printing), created once the app is ready

function fromApp(event) {
  const url = event.senderFrame?.url || '';
  return isAppUrl(url);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromApp(event)) {
      log('WARN', `Rejected IPC ${channel} from ${event.senderFrame?.url}`);
      throw new Error('Forbidden');
    }
    return fn(event, ...args);
  });
}

function registerIpc() {
  handle('desktop:get-config', () => resolveConfig());
  handle('desktop:get-startup-status', () => getStartupStatus());

  handle('desktop:retry-start', async () => {
    log('INFO', 'Start retried by the operator');
    await shutdownServer();
    return resolveConfig();
  });

  // Back to this computer's own database (an administrator task: the UI offers it under Support only)
  handle('desktop:use-builtin-server', async () => {
    clearPairing();
    await forgetSavedSignIn();
    log('INFO', 'Connection to the shared host removed; using this computer\'s own database');
    return resolveConfig();
  });

  handle('desktop:connect-to-host', (_e, pairingString) => pairWithHost(String(pairingString || '')));

  // Device sign-in. Arguments are never logged: they carry the PIN and the session token.
  handle('auth:status', () => (pinLockOff() ? { state: 'disabled' } : authVault().status()));
  handle('auth:setup', (_e, request) => (pinLockOff() ? { ok: false, code: 'unavailable' } : authVault().setup(request)));
  handle('auth:unlock', (_e, pin) => (pinLockOff() ? { ok: false, code: 'unavailable' } : authVault().unlock(pin)));
  handle('auth:clear', () => authVault().clear());

  handle('desktop:get-app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    packaged: app.isPackaged,
    logFile: logPath(),
    dataDir: embedded ? dataDir() : null,
  }));

  handle('desktop:get-diagnostics', () => collectDiagnostics());

  handle('update:get-state', () => updates.agent.publicState());
  handle('update:check', () => updates.agent.check());
  handle('update:enroll', (_e, code) => updates.agent.enroll(code, os.hostname()));
  const ownerOnly = (fn) => async (event, token, ...args) => {
    if (await isOwnerToken(token)) return fn(event, ...args);
    log('WARN', 'An update action was refused: the signed-in account is not the owner');
    return { ok: false, code: 'not_owner', error: 'Only the owner can do this.' };
  };
  handle('update:now', ownerOnly(() => updates.agent.updateNow()));
  handle('update:remind-later', () => updates.agent.remindLater());
  handle('update:set-policy', ownerOnly((_e, next) => updates.agent.setPolicy(next)));
  handle('update:approve', ownerOnly(() => updates.agent.approvePending()));
  handle('update:pause-download', ownerOnly((_e, paused) => updates.agent.pauseDownload(paused === true)));
  handle('update:install-from-folder', ownerOnly(async (event) => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Choose the update folder (on the pen drive)', properties: ['openDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    return updates.agent.prepareFromFolder(picked.filePaths[0]);
  }));
  handle('update:report-activity', (_e, unsaved) => {
    updates.activity.rendererReport(unsaved);
    return true;
  });

  handle('desktop:get-backup-status', () => backupStatus());
  handle('desktop:backup-now', () => runBackup('manual'));
  handle('desktop:choose-backup-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win, { title: 'Choose a folder for backups (a USB drive or cloud-synced folder is best)', properties: ['openDirectory', 'createDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    const dir = picked.filePaths[0];
    if (!backup.folderWritable(dir)) return { ok: false, error: 'The app cannot write to that folder. Choose another.' };
    saveSettings({ backupDir: dir });
    log('INFO', 'Backup folder changed');
    return { ok: true };
  });
  handle('desktop:restore-backup', async (event, name) => {
    restoreBusy = true;
    try {
      return await restoreBackup(BrowserWindow.fromWebContents(event.sender), typeof name === 'string' ? name : null);
    } finally {
      restoreBusy = false;
    }
  });

  handle('desktop:log', (_e, level, message) => {
    const lvl = ['INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO';
    log(lvl, message, 'renderer');
    return true;
  });

  handle('desktop:list-printers', async (event) => {
    const printers = await event.sender.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault, status: p.status }));
  });

  handle('desktop:print', (event, options) => {
    const deviceName = typeof options?.deviceName === 'string' ? options.deviceName.slice(0, 200) : undefined;
    return new Promise((resolve) => {
      event.sender.print({ silent: false, printBackground: true, deviceName }, (success, failureReason) => {
        if (!success) log('WARN', `Print failed: ${failureReason}`);
        resolve({ ok: success, error: success ? null : failureReason });
      });
    });
  });
}

// ------------------------------------------------------------------ support: why can this person not sign in?
/**
 * `app.exe --diagnose-login=<email> [--check-password]` (support, on the affected PC): reads this PC's own database
 * WITHOUT starting the server, running migrations or changing anything, and writes what it found (one JSON
 * object, no passwords/hashes/tokens) to logs/diagnose-login.json. With --check-password the password to test
 * is taken from the FOODCOURT_DIAG_PASSWORD environment variable so it never appears on a command line.
 */
async function runLoginDiagnosis(email, checkPassword) {
  let exitCode = 0;
  try {
    const runtime = locateRuntime(serverDir());
    if (!runtime) throw new Error('The built-in server files were not found.');
    const out = await artisanFor(runtime, dataDir())(['foodcourt:diagnose-login', email, ...(checkPassword ? ['--check-password'] : [])]);
    const file = path.join(path.dirname(logPath()), 'diagnose-login.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out.trim().split(/\r?\n/).pop() + '\n', 'utf8');
    process.stdout.write(out.trim() + '\n');
    log('INFO', 'Sign-in diagnosis written to diagnose-login.json');
  } catch (err) {
    exitCode = 1;
    process.stdout.write(JSON.stringify({ error: String(err && (err.output || err.message)).slice(0, 500) }) + '\n');
  }
  app.exit(exitCode);
}

// ------------------------------------------------------------------ lifecycle
const diagnoseArg = process.argv.find((a) => a.startsWith('--diagnose-login='));
if (diagnoseArg) {
  app.whenReady().then(() => runLoginDiagnosis(diagnoseArg.slice('--diagnose-login='.length), process.argv.includes('--check-password')));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Refuse every web permission prompt (camera, microphone, notifications, geolocation...)
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    // A paired PC identifies itself to its host with the device token; only requests to that host get it
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const p = readPairing();
      if (p && pairing.shouldAttachDeviceToken(details.url, p.apiBaseUrl)) details.requestHeaders['X-Device-Token'] = p.token;
      callback({ requestHeaders: details.requestHeaders });
    });
    printing = createPrinting({
      app,
      BrowserWindow,
      handle,
      getWindows: () => BrowserWindow.getAllWindows(),
      log,
      listPrinters: async () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getPrintersAsync() : []),
    });
    updates = createUpdates({
      powerMonitor,
      app,
      net,
      safeStorage,
      log,
      shutdownServer,
      dataDir,
      readConfig,
      resolveConfig,
      probe,
      getStartup: () => startup,
      printBusy: async () => (await printing.service.list(200)).some((j) => j.status === 'queued' || j.status === 'processing'),
      maintenanceBusy: () => backupBusy || restoreBusy,
      hasWindow: () => Boolean(mainWindow && !mainWindow.isDestroyed()),
      // A paired terminal has no payments of its own: the host holds them, and each of its screens reports its own work
      openUpiCount: async () => {
        if (readConfig().apiBaseUrl) return 0;
        const report = backup.parseReport(await embedded.artisan(['foodcourt:update-db', 'activity']));
        if (!report || !report.ok) throw new Error('no answer');
        return report.open_upi;
      },
    });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      updates.activity.requestStarted(details.id, details.method);
      callback({});
    });
    session.defaultSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => updates.activity.requestFinished(details.id));
    session.defaultSession.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*'] }, (details) => updates.activity.requestFinished(details.id));
    registerIpc();
    printing.registerIpc();
    buildMenu();
    if (!readConfig().apiBaseUrl) startBuiltInServer(); // start services while the window loads
    createWindow();
    updates.afterWindow(mainWindow);
    printing.start(); // resumes queued jobs; jobs that were mid-print at the last shutdown are marked failed, never re-sent
    log('INFO', `Started v${app.getVersion()} (electron ${process.versions.electron})`);
  });

  app.on('will-quit', () => {
    if (printing) void printing.shutdown();
    void shutdownServer();
  });
  process.on('exit', () => {
    void shutdownServer();
  });

  app.on('window-all-closed', () => {
    log('INFO', 'All windows closed, quitting');
    app.quit();
  });

  process.on('uncaughtException', (err) => log('ERROR', `uncaughtException: ${err?.stack || err}`));
}
