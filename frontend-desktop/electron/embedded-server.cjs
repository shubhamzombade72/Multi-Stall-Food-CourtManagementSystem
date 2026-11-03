/**
 * Built-in server for the single-PC desktop install.
 *
 * The installer ships a minimal PHP runtime and the Laravel API (see scripts/prepare-embedded-server.mjs).
 * On launch the app starts that API on 127.0.0.1 (never reachable from the network) with its own SQLite
 * database in the user's data folder, so the operator never has to enter a server address.
 *
 * Everything that must be writable (database, logs, caches, app key) lives in `dataDir`, never beside the
 * program files. Pure helpers are exported for unit tests; no Electron imports here.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const START_TIMEOUT_MS = 40000;
const MIGRATE_TIMEOUT_MS = 120000;
const KEEP_BACKUPS = 5;

/**
 * Laravel treats only paths starting with / or \ as absolute for its APP_*_CACHE overrides, so a drive
 * letter ("C:\...") would be wrongly joined onto the app folder. Dropping the drive is safe because the
 * server is started with its working directory on the data folder's drive.
 */
function rootedPath(p) {
  return String(p).replace(/^[A-Za-z]:/, '');
}

/** Returns the runtime layout when php.exe and the API are present in `serverDir`, otherwise null. */
function locateRuntime(serverDir) {
  if (!serverDir) return null;
  const php = path.join(serverDir, 'php', 'php.exe');
  const backendDir = path.join(serverDir, 'backend');
  const router = path.join(serverDir, 'router.php');
  if (![php, path.join(backendDir, 'artisan'), router].every((f) => fs.existsSync(f))) return null;
  return { serverDir, php, phpDir: path.dirname(php), backendDir, router };
}

/** php.ini is deliberately not used (-n): every setting is explicit, so a PC's own PHP can never interfere. */
function phpArgs(runtime, dataDir) {
  const ext = path.join(runtime.phpDir, 'ext');
  return [
    '-n',
    '-d', `extension_dir=${ext}`,
    '-d', 'extension=php_mbstring.dll',
    '-d', 'extension=php_openssl.dll',
    '-d', 'extension=php_pdo_sqlite.dll',
    '-d', 'extension=php_sqlite3.dll',
    '-d', 'extension=php_fileinfo.dll',
    '-d', 'zend_extension=php_opcache.dll',
    '-d', 'opcache.enable=1',
    '-d', 'opcache.validate_timestamps=0', // the code never changes while the app runs; updates restart it
    '-d', 'memory_limit=256M',
    '-d', 'date.timezone=UTC',
    '-d', 'display_errors=0',
    '-d', 'log_errors=1',
    '-d', `error_log=${path.join(dataDir, 'logs', 'php-error.log')}`,
    '-d', `sys_temp_dir=${path.join(dataDir, 'tmp')}`,
  ];
}

/** Environment for every PHP process the app starts. Only non-secret values besides the generated app key. */
function buildServerEnv(dataDir, appKey, baseEnv = process.env) {
  const cache = (name) => rootedPath(path.join(dataDir, 'cache', name));
  return {
    ...baseEnv,
    APP_ENV: 'production',
    APP_DEBUG: 'false',
    APP_KEY: appKey,
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: path.join(dataDir, 'foodcourt.sqlite'),
    DB_FOREIGN_KEYS: 'true',
    CACHE_STORE: 'file',
    SESSION_DRIVER: 'array',
    QUEUE_CONNECTION: 'sync',
    BROADCAST_CONNECTION: 'null',
    LOG_CHANNEL: 'single',
    LOG_LEVEL: 'warning',
    FOODCOURT_EMBEDDED: 'true',
    LARAVEL_STORAGE_PATH: path.join(dataDir, 'storage'),
    APP_PACKAGES_CACHE: cache('packages.php'),
    APP_SERVICES_CACHE: cache('services.php'),
    APP_CONFIG_CACHE: cache('config.php'),
    APP_ROUTES_CACHE: cache('routes.php'),
    APP_EVENTS_CACHE: cache('events.php'),
  };
}

function ensureDataDirs(dataDir) {
  [
    'logs', 'tmp', 'cache', 'backups',
    'storage/app/public', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs',
  ].forEach((d) => fs.mkdirSync(path.join(dataDir, d), { recursive: true }));
  // Stale discovery caches from an older program version would list providers that no longer exist
  const cacheDir = path.join(dataDir, 'cache');
  fs.readdirSync(cacheDir).filter((f) => f.endsWith('.php')).forEach((f) => fs.rmSync(path.join(cacheDir, f), { force: true }));
}

/** A random application key, generated once per installation and kept with the data. */
function ensureAppKey(dataDir) {
  const file = path.join(dataDir, 'app.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^base64:[A-Za-z0-9+/=]{43,}$/.test(existing)) return existing;
  } catch {
    // first run
  }
  const key = `base64:${crypto.randomBytes(32).toString('base64')}`;
  fs.writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 });
  return key;
}

/** Copy the database aside before the first start of a new program version (migrations may change it). */
function backupBeforeUpgrade(dataDir, version, log) {
  const db = path.join(dataDir, 'foodcourt.sqlite');
  const marker = path.join(dataDir, 'last-version.txt');
  let previous = '';
  try {
    previous = fs.readFileSync(marker, 'utf8').trim();
  } catch {
    // none yet
  }
  if (previous && previous !== version && fs.existsSync(db) && fs.statSync(db).size > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dataDir, 'backups', `foodcourt-before-${version}-${stamp}.sqlite`);
    fs.copyFileSync(db, target);
    log('INFO', `Database backed up to ${target} before upgrading ${previous} -> ${version}`);
    const all = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.sqlite')).sort();
    all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).forEach((f) => fs.rmSync(path.join(dataDir, 'backups', f), { force: true }));
  }
  fs.writeFileSync(marker, version, 'utf8');
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function probeUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/up', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function runArtisan(runtime, dataDir, env, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.php, [...phpArgs(runtime, dataDir), path.join(runtime.backendDir, 'artisan'), ...args, '--no-interaction'], {
      cwd: dataDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const collect = (b) => (out = (out + b.toString()).slice(-4000));
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill(), MIGRATE_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`artisan ${args[0]} failed (exit ${code}): ${out.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-600)}`));
    });
  });
}

/**
 * Starts the built-in server: prepares the data folder, applies database migrations, launches PHP on a
 * free loopback port and waits until /up answers. Resolves { url, port, stop }.
 */
async function startEmbeddedServer({ runtime, dataDir, version, log }) {
  ensureDataDirs(dataDir);
  const env = buildServerEnv(dataDir, ensureAppKey(dataDir));
  backupBeforeUpgrade(dataDir, version, log);
  fs.closeSync(fs.openSync(path.join(dataDir, 'foodcourt.sqlite'), 'a')); // create the empty database file on first run

  await runArtisan(runtime, dataDir, env, ['migrate', '--force']);
  log('INFO', 'Database migrations applied');

  const port = await findFreePort();
  let child = null;
  let stopping = false;
  const restarts = [];

  const launch = () => {
    child = spawn(
      runtime.php,
      [...phpArgs(runtime, dataDir), '-S', `127.0.0.1:${port}`, '-t', path.join(runtime.backendDir, 'public'), runtime.router],
      { cwd: dataDir, env, windowsHide: true, stdio: 'ignore' }
    );
    child.on('exit', (code) => {
      if (stopping) return;
      log('ERROR', `Built-in server exited unexpectedly (code ${code})`);
      const now = Date.now();
      restarts.push(now);
      while (restarts.length && now - restarts[0] > 60000) restarts.shift();
      if (restarts.length <= 5) setTimeout(() => !stopping && launch(), 500);
      else log('ERROR', 'Built-in server restarted too often; giving up');
    });
  };
  launch();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeUp(port)) {
      log('INFO', `Built-in server ready on 127.0.0.1:${port}`);
      return {
        port,
        url: `http://127.0.0.1:${port}/api`,
        stop: () => {
          stopping = true;
          try {
            child?.kill();
          } catch {
            // already gone
          }
        },
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  stopping = true;
  child?.kill();
  throw new Error(`The built-in server did not become ready within ${START_TIMEOUT_MS / 1000} s`);
}

module.exports = { rootedPath, locateRuntime, phpArgs, buildServerEnv, ensureAppKey, backupBeforeUpgrade, startEmbeddedServer };
