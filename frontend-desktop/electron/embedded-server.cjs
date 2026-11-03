/**
 * Built-in server for the single-PC desktop install.
 *
 * The installer ships a minimal PHP runtime and the Laravel API (see scripts/prepare-embedded-server.mjs).
 * On launch the app starts that API on 127.0.0.1 (never reachable from the network) with its own SQLite
 * database in the user's data folder, so the operator never has to enter a server address.
 *
 * Lifecycle (every step reports a plain-language status through `onStatus`):
 *   1. prepare the data folder, app key and pre-upgrade backup
 *   2. reclaim a PHP process this app left behind after a crash (only ours, never another PHP)
 *   3. apply database migrations
 *   4. start PHP on a free loopback port (another port is tried if one cannot be bound)
 *   5. wait for /up, then for /api/system/ready (database reachable, migrations current)
 *   6. watch the process while the app runs and restart it if it stops answering
 *
 * Everything that must be writable (database, logs, caches, app key) lives in `dataDir`, never beside the
 * program files. Pure helpers are exported for unit tests; no Electron imports here.
 */
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const START_TIMEOUT_MS = 40000;
const START_ATTEMPTS = 3; // a different free port is tried if PHP cannot bind the first one
const READY_TIMEOUT_MS = 15000;
const MIGRATE_TIMEOUT_MS = 120000;
const WATCHDOG_INTERVAL_MS = 10000;
const WATCHDOG_FAILURES = 3;
const KEEP_BACKUPS = 5;

/** Plain-language failure reasons. Raw technical detail goes to the log only, never to the screen. */
const FAILURE = {
  runtime_missing: 'The program files needed to start the Food Court system are missing or damaged. Reinstall the application (your data is kept).',
  data_folder: "This computer's data folder could not be used. Check that the disk is not full and that you are signed in to Windows with your normal account.",
  database_unavailable: 'The database on this computer could not be opened. Your data has not been changed. Restore a backup, or contact your administrator.',
  migration_failed: 'The database could not be brought up to date for this version. Your data has not been changed. Contact your administrator.',
  server_timeout: 'The Food Court services did not start in time. Close the application and open it again. If this repeats, restart the computer.',
  not_ready: 'The Food Court services started but are not healthy. Close the application and open it again, or contact your administrator.',
};

class StartupError extends Error {
  constructor(code, detail) {
    super(FAILURE[code] || 'The Food Court system could not start.');
    this.code = code;
    this.detail = detail || '';
  }
}

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
    const all = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith('foodcourt-before-') && f.endsWith('.sqlite')).sort();
    all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).forEach((f) => fs.rmSync(path.join(dataDir, 'backups', f), { force: true }));
  }
  fs.writeFileSync(marker, version, 'utf8');
}

// ------------------------------------------------------------------ process ownership

const pidFile = (dataDir) => path.join(dataDir, 'server.pid');

/** True only for a PHP process that this app started: its command line carries this installation's data folder. */
function isOurProcess(commandLine, dataDir) {
  const cmd = String(commandLine || '').toLowerCase();
  const data = String(dataDir).toLowerCase();
  return cmd.includes('php') && cmd.includes(data) && cmd.includes('-s');
}

function commandLineOf(pid) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => resolve(err ? '' : String(stdout).trim())
    );
  });
}

/**
 * After a crash or a forced close the previous built-in server may still be running and holding the
 * database. It is stopped only if the recorded process is a PHP started by this app for this data folder.
 */
async function reclaimOrphan(dataDir, log, inspect = commandLineOf) {
  const file = pidFile(dataDir);
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  fs.rmSync(file, { force: true });
  const pid = Number(rec && rec.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const cmd = await inspect(pid);
  if (!cmd) return false; // process is gone
  if (!isOurProcess(cmd, dataDir)) {
    log('WARN', `Process ${pid} from a previous run is not the built-in server any more; left alone`);
    return false;
  }
  try {
    process.kill(pid);
    log('WARN', `Stopped built-in server process ${pid} left behind by a previous run`);
    await new Promise((r) => setTimeout(r, 800));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ network helpers

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

function getJson(port, urlPath, timeout = 2500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout, headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          // not JSON
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

const probeUp = async (port) => (await getJson(port, '/up', 2000))?.status === 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const clean = out.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (code === 0) resolve(clean);
      else reject(Object.assign(new Error(`artisan ${args[0]} failed (exit ${code}): ${clean.slice(-600)}`), { output: clean, exitCode: code }));
    });
  });
}

/** Maps a failed `migrate` to a user-facing category (technical text stays in the log). */
function classifyMigrationFailure(message) {
  return /unable to open|malformed|not a database|disk image|readonly|locked/i.test(String(message)) ? 'database_unavailable' : 'migration_failed';
}

// ------------------------------------------------------------------ lifecycle

/**
 * Starts the built-in server and resolves once it is healthy:
 * { url, port, status(), restart(), stop(), artisan(args) }. `stop()` resolves after the PHP process has
 * exited, so the database file can safely be replaced afterwards (backup restore).
 * Rejects with a StartupError (`code`, user-safe `message`, technical `detail`) and status 'failed'.
 */
async function startEmbeddedServer({ runtime, dataDir, version, log, onStatus, portFinder = findFreePort }) {
  let current = { phase: 'starting', message: 'Starting application…' };
  const setStatus = (phase, message, extra = {}) => {
    current = { phase, message, ...extra };
    try {
      onStatus && onStatus(current);
    } catch {
      // a listener must never break startup
    }
  };

  let child = null;
  let port = 0;
  let stopping = false;
  let watchdog = null;
  const restarts = [];

  try {
    setStatus('starting', 'Starting application…');
    let env;
    try {
      ensureDataDirs(dataDir);
      env = buildServerEnv(dataDir, ensureAppKey(dataDir));
      await reclaimOrphan(dataDir, log);
      backupBeforeUpgrade(dataDir, version, log);
      fs.closeSync(fs.openSync(path.join(dataDir, 'foodcourt.sqlite'), 'a')); // create the empty database file on first run
    } catch (err) {
      throw new StartupError('data_folder', String(err && err.message));
    }

    setStatus('preparing_database', 'Preparing database…');
    try {
      await runArtisan(runtime, dataDir, env, ['migrate', '--force']);
    } catch (err) {
      throw new StartupError(classifyMigrationFailure(err.message), err.message);
    }
    log('INFO', 'Database migrations applied');

    setStatus('connecting', 'Connecting to food court services…');

    const launch = (p) => {
      child = spawn(runtime.php, [...phpArgs(runtime, dataDir), '-S', `127.0.0.1:${p}`, '-t', path.join(runtime.backendDir, 'public'), runtime.router], {
        cwd: dataDir,
        env,
        windowsHide: true,
        stdio: 'ignore',
      });
      const mine = child;
      try {
        fs.writeFileSync(pidFile(dataDir), JSON.stringify({ pid: mine.pid, port: p, startedAt: new Date().toISOString() }), 'utf8');
      } catch {
        // the pid file is a convenience for crash recovery
      }
      mine.on('exit', (code) => {
        mine.exited = true;
        if (stopping || mine !== child || !current.phase || current.phase === 'failed') return;
        if (current.phase === 'connecting') return; // startup loop handles an early exit itself
        log('ERROR', `Built-in server exited unexpectedly (code ${code})`);
        const now = Date.now();
        restarts.push(now);
        while (restarts.length && now - restarts[0] > 60000) restarts.shift();
        if (restarts.length <= 5) {
          setStatus('degraded', 'Reconnecting to food court services…', { port });
          setTimeout(() => !stopping && relaunch(), 500);
        } else {
          log('ERROR', 'Built-in server restarted too often; giving up');
          setStatus('failed', FAILURE.not_ready, { code: 'not_ready', port });
        }
      });
      return mine;
    };

    const relaunch = async () => {
      launch(port);
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (!stopping && Date.now() < deadline) {
        if (await probeUp(port)) {
          log('INFO', 'Built-in server recovered');
          setStatus('ready', 'Application ready.', { port });
          return;
        }
        await sleep(300);
      }
      if (!stopping && child) {
        log('ERROR', 'Built-in server did not answer after a restart');
        child.kill(); // its 'exit' handler counts this as another failed restart
      }
    };

    // Try up to START_ATTEMPTS free ports: another program could take the port between "find" and "bind"
    let up = false;
    for (let attempt = 1; attempt <= START_ATTEMPTS && !up; attempt++) {
      port = await portFinder(attempt);
      const mine = launch(port);
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline && !mine.exited) {
        if (await probeUp(port)) {
          up = true;
          break;
        }
        await sleep(250);
      }
      if (!up) {
        log('WARN', `Built-in server did not answer on 127.0.0.1:${port} (attempt ${attempt}/${START_ATTEMPTS})`);
        try {
          mine.kill();
        } catch {
          // already gone
        }
        child = null;
      }
    }
    if (!up) throw new StartupError('server_timeout', `no answer after ${START_ATTEMPTS} attempts`);

    // /up only proves PHP runs. Ask the API whether the database and migrations are healthy too.
    let ready = null;
    const readyDeadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < readyDeadline) {
      const r = await getJson(port, '/api/system/ready', 4000);
      if (r && r.json && r.json.data) {
        ready = r.json.data;
        if (ready.ready) break;
      }
      await sleep(400);
    }
    if (!ready || !ready.ready) {
      const code = ready && ready.database === false ? 'database_unavailable' : ready && ready.migrations_current === false ? 'migration_failed' : 'not_ready';
      throw new StartupError(code, JSON.stringify(ready));
    }

    log('INFO', `Built-in server ready on 127.0.0.1:${port} (setup: ${ready.setup})`);
    setStatus('ready', 'Application ready.', { port, setup: ready.setup });

    // Health watchdog: a server that stops answering while the app is open is restarted
    let misses = 0;
    watchdog = setInterval(async () => {
      if (stopping || current.phase !== 'ready') return;
      if (await probeUp(port)) {
        misses = 0;
        return;
      }
      if (++misses < WATCHDOG_FAILURES) return;
      misses = 0;
      log('ERROR', 'Built-in server stopped answering; restarting it');
      setStatus('degraded', 'Reconnecting to food court services…', { port });
      try {
        child && child.kill();
      } catch {
        // already gone
      }
      // the 'exit' handler above restarts it and reports the recovery
    }, WATCHDOG_INTERVAL_MS);
    watchdog.unref();

    return {
      port,
      url: `http://127.0.0.1:${port}/api`,
      status: () => current,
      artisan: (args) => runArtisan(runtime, dataDir, env, args),
      stop: () =>
        new Promise((resolve) => {
          stopping = true;
          if (watchdog) clearInterval(watchdog);
          const done = () => {
            fs.rmSync(pidFile(dataDir), { force: true });
            resolve();
          };
          if (!child || child.exited) return done();
          const timer = setTimeout(done, 5000);
          child.once('exit', () => {
            clearTimeout(timer);
            done();
          });
          try {
            child.kill();
          } catch {
            clearTimeout(timer);
            done();
          }
        }),
    };
  } catch (err) {
    stopping = true;
    if (watchdog) clearInterval(watchdog);
    try {
      child && child.kill();
    } catch {
      // already gone
    }
    const startup = err instanceof StartupError ? err : new StartupError('not_ready', String(err && err.message));
    log('ERROR', `Startup failed [${startup.code}]: ${startup.detail}`);
    setStatus('failed', startup.message, { code: startup.code });
    throw startup;
  }
}

/** An artisan runner that works without the web server (backup verification before a restore, failed starts). */
function artisanFor(runtime, dataDir) {
  ensureDataDirs(dataDir);
  const env = buildServerEnv(dataDir, ensureAppKey(dataDir));
  return (args) => runArtisan(runtime, dataDir, env, args);
}

module.exports = {
  artisanFor,
  FAILURE,
  StartupError,
  rootedPath,
  locateRuntime,
  phpArgs,
  buildServerEnv,
  ensureAppKey,
  backupBeforeUpgrade,
  isOurProcess,
  reclaimOrphan,
  classifyMigrationFailure,
  startEmbeddedServer,
};
