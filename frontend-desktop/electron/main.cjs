/**
 * FoodCourt Desktop - Electron main process.
 *
 * Security model:
 *  - Renderer runs with contextIsolation, sandbox and no Node integration.
 *  - The renderer reaches the main process only through the allowlisted IPC channels below, and every
 *    handler checks that the call comes from the app's own page.
 *  - The app stores ONLY a server address (userData/config.json) and, in single-PC mode, its own local
 *    database folder. By default it starts a built-in server on 127.0.0.1 (electron/embedded-server.cjs),
 *    so nothing needs configuring; the address override exists for installs that use a shared server.
 *    It never holds database credentials for any external database; all data access goes through the
 *    authenticated Laravel API.
 *  - Navigation away from the app, new windows and web permission requests (camera, mic, geolocation...)
 *    are refused.
 */
const { app, BrowserWindow, ipcMain, Menu, net, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeApiUrl, describeApiUrlWarnings, classifyNetworkError, classifyApiProbe, parseBundledConfig } = require('./config.cjs');
const { locateRuntime, startEmbeddedServer } = require('./embedded-server.cjs');

const DEV_URL = process.env.ELECTRON_START_URL || ''; // e.g. http://localhost:3000 for `pnpm dev`

// Automated tests run the app against a throw-away profile so they never touch a real install's settings
if (process.env.FOODCOURT_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.FOODCOURT_USER_DATA_DIR));
}
const MAX_LOG_BYTES = 2 * 1024 * 1024;

// ------------------------------------------------------------------ persistent configuration
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const bundledConfigPath = () => path.join(__dirname, 'app-config.json');
const logPath = () => path.join(app.getPath('userData'), 'logs', 'desktop.log');

/**
 * Which server the app talks to. There is deliberately NO built-in default address: a packaged app that
 * silently tried 127.0.0.1 could never work on a PC that does not host the server. Order of precedence:
 *   1. the address saved by the operator in Server settings (userData/config.json)
 *   2. FOODCOURT_API_URL (development / automated tests)
 *   3. electron/app-config.json, the explicit production address set by the release engineer
 * When none is set, apiBaseUrl is null and the UI shows the Server Setup screen.
 */
function readConfig() {
  let saved = null;
  try {
    saved = normalizeApiUrl(JSON.parse(fs.readFileSync(configPath(), 'utf8')).apiBaseUrl);
  } catch {
    // no / unreadable config file: fall through to the other sources
  }
  if (saved) return { apiBaseUrl: saved, source: 'saved' };
  const fromEnv = normalizeApiUrl(process.env.FOODCOURT_API_URL);
  if (fromEnv) return { apiBaseUrl: fromEnv, source: 'environment' };
  let bundled = null;
  try {
    bundled = parseBundledConfig(fs.readFileSync(bundledConfigPath(), 'utf8'));
  } catch {
    // missing bundled config: unconfigured
  }
  if (bundled) return { apiBaseUrl: bundled, source: 'release' };
  return { apiBaseUrl: null, source: 'none' };
}

// ------------------------------------------------------------------ built-in server (single-PC mode)
const serverDir = () =>
  process.env.FOODCOURT_SERVER_DIR || (app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..', 'build-server'));
const dataDir = () => process.env.FOODCOURT_DATA_DIR || path.join(app.getPath('userData'), 'server');

let embedded = null; // { url, port, stop } once running
let embeddedStart = null; // in-flight / finished start; reset on failure so "retry" starts again
let embeddedError = null;

function startBuiltInServer() {
  if (embeddedStart) return embeddedStart;
  const runtime = locateRuntime(serverDir());
  if (!runtime) {
    embeddedError = null; // not bundled (development run): the Server Setup screen is shown instead
    return (embeddedStart = Promise.resolve(null));
  }
  embeddedStart = startEmbeddedServer({ runtime, dataDir: dataDir(), version: app.getVersion(), log })
    .then((server) => {
      embedded = server;
      embeddedError = null;
      return server;
    })
    .catch((err) => {
      embeddedError = String(err?.message || err);
      log('ERROR', `Built-in server failed to start: ${embeddedError}`);
      embeddedStart = null;
      return null;
    });
  return embeddedStart;
}

/** The server this run talks to: an explicitly configured remote one, otherwise the built-in server. */
async function resolveConfig() {
  const remote = readConfig();
  if (remote.apiBaseUrl) return { ...remote, mode: 'remote', error: null };
  const server = await startBuiltInServer();
  if (server) return { apiBaseUrl: server.url, source: 'embedded', mode: 'embedded', error: null };
  return { apiBaseUrl: null, source: 'none', mode: 'none', error: embeddedError };
}

function shutdownServer() {
  try {
    embedded?.stop();
  } catch {
    // already stopped
  }
  embedded = null;
}

const PROBE_TIMEOUT_MS = 8000;

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    return { status: res.status };
  } catch (err) {
    return { error: controller.signal.aborted ? 'timeout' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Connectivity check run from the main process so DNS / TLS / refused / timeout can be told apart. */
async function testConnection(rawUrl) {
  const base = normalizeApiUrl(rawUrl);
  if (!base) return { ok: false, code: 'invalid_url', message: 'Enter a full http(s) address ending in /api, e.g. https://api.example.com/api' };
  const api = await probe(`${base}/auth/me`); // unauthenticated: a healthy Food Court API answers 401 JSON
  if (api.error) return { ok: false, ...classifyNetworkError(api.error), url: base };
  if (api.status >= 300 && api.status < 400) {
    return { ok: false, code: 'redirect', message: 'The server redirected the request (for example http to https). Use the final https:// address.', url: base, apiStatus: api.status };
  }
  const verdict = classifyApiProbe(api.status);
  const health = await probe(`${base.replace(/\/api$/, '')}/up`);
  return { ...verdict, url: base, apiStatus: api.status, healthStatus: health.status ?? null };
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configPath()); // atomic replace: a crash never leaves a half-written config
}

function log(level, message) {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, file + '.1');
    }
    const line = `${new Date().toISOString()} [${level}] ${String(message).replace(/[\r\n]+/g, ' ').slice(0, 2000)}\n`;
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    // logging must never crash the app
  }
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
    title: 'FoodCourt Desktop',
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
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

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
    renderer.api = !api ? { base: null, note: 'no API address configured (Server Setup screen expected)' } : await win.webContents.executeJavaScript(`(async () => {
      const base = ${JSON.stringify(api)};
      const probe = async (url, init) => { try { return (await fetch(url, init)).status; } catch (e) { return 'error: ' + e.message; } };
      return {
        base,
        health: await probe(base.replace(/\\/api$/, '') + '/up'),
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
      bodyText: document.body.innerText.slice(0, 120),
    })`)) };
  } catch (err) {
    renderer = { error: String(err) };
  }
  const result = {
    contextIsolation: prefs.contextIsolation === true,
    nodeIntegration: prefs.nodeIntegration === false,
    sandbox: prefs.sandbox === true,
    webSecurity: prefs.webSecurity !== false,
    rendererHasNoRequire: renderer.nodeRequire === 'undefined',
    rendererHasNoProcess: renderer.nodeProcess === 'undefined',
    bridgeAllowlist: JSON.stringify(renderer.bridgeKeys) === JSON.stringify(['getAppInfo', 'getConfig', 'listPrinters', 'log', 'print', 'setApiBaseUrl', 'testConnection', 'useBuiltInServer']),
    cspPresent: typeof renderer.csp === 'string' && renderer.csp.includes("script-src 'self'"),
    appRendered: renderer.appRendered === true,
    route: renderer.route,
    version: app.getVersion(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
    configFile: configPath(),
    api: renderer.api, // informational, not part of pass/fail: depends on a server being up
  };
  const pass = ['contextIsolation', 'nodeIntegration', 'sandbox', 'webSecurity', 'rendererHasNoRequire', 'rendererHasNoProcess', 'bridgeAllowlist', 'cspPresent', 'appRendered']
    .every((k) => result[k] === true);
  process.stdout.write(`SMOKE_RESULT ${JSON.stringify({ pass, ...result, renderer })}\n`);
  log('INFO', `Smoke test ${pass ? 'PASSED' : 'FAILED'}`);
  shutdownServer();
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

  handle('desktop:use-builtin-server', () => {
    writeConfig({});
    log('INFO', 'Saved server address cleared; using the built-in server');
    return resolveConfig();
  });

  handle('desktop:set-api-base-url', (_e, url) => {
    const normalized = normalizeApiUrl(url);
    if (!normalized) {
      return { ok: false, error: 'Enter a full http(s) address ending in /api, e.g. https://api.example.com/api' };
    }
    writeConfig({ apiBaseUrl: normalized });
    log('INFO', `API base URL set to ${normalized}`);
    return { ok: true, apiBaseUrl: normalized, warnings: describeApiUrlWarnings(normalized) };
  });

  handle('desktop:test-connection', async (_e, url) => {
    const result = await testConnection(url);
    log(result.ok ? 'INFO' : 'WARN', `Connection test ${result.url || ''}: ${result.code}`);
    return result;
  });

  handle('desktop:get-app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    packaged: app.isPackaged,
    logFile: logPath(),
    dataDir: embedded ? dataDir() : null,
  }));

  handle('desktop:log', (_e, level, message) => {
    const lvl = ['INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO';
    log(lvl, `[renderer] ${message}`);
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

// ------------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
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
    registerIpc();
    buildMenu();
    if (!readConfig().apiBaseUrl) startBuiltInServer(); // warm up while the window loads
    createWindow();
    log('INFO', `Started v${app.getVersion()} (electron ${process.versions.electron})`);
  });

  app.on('will-quit', shutdownServer);
  process.on('exit', shutdownServer);

  app.on('window-all-closed', () => {
    log('INFO', 'All windows closed, quitting');
    app.quit();
  });

  process.on('uncaughtException', (err) => log('ERROR', `uncaughtException: ${err?.stack || err}`));
}
