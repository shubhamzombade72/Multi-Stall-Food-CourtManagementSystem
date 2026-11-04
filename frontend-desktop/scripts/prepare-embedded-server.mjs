/**
 * Assembles the built-in server that the desktop installer ships (see electron/embedded-server.cjs):
 *
 *   build-server/backend   Laravel API, production dependencies only, no tests, no .env, no demo seeders
 *   build-server/php       minimal PHP runtime (php.exe + the few DLLs/extensions the API uses)
 *
 * Runs before `electron-builder` (see the dist scripts). Inputs: ../backend and a PHP 8.3 install
 * (FOODCOURT_PHP_DIR, or the directory of `php` on PATH). Nothing here touches any database.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const backendSrc = resolve(desktopDir, '..', 'backend');
const stage = join(desktopDir, 'build-server');

const phpDir = (() => {
  if (process.env.FOODCOURT_PHP_DIR) return resolve(process.env.FOODCOURT_PHP_DIR);
  const where = execFileSync('where', ['php.exe'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  return dirname(where);
})();
if (!existsSync(join(phpDir, 'php.exe'))) throw new Error(`php.exe not found in ${phpDir}`);

const log = (m) => console.log(`[embedded-server] ${m}`);
const sizeMb = (p) => {
  let total = 0;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : (total += statSync(join(d, e.name)).size)));
  walk(p);
  return (total / 1048576).toFixed(1);
};

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'backend'), { recursive: true });
mkdirSync(join(stage, 'php', 'ext'), { recursive: true });

// ------------------------------------------------------------------ backend
const copy = (rel, filter) => cpSync(join(backendSrc, rel), join(stage, 'backend', rel), { recursive: true, filter });
['app', 'config', 'routes', 'artisan', 'composer.json', 'composer.lock'].forEach((p) => copy(p));
copy('database/migrations'); // schema only: no seeders (they create demo accounts) and no factories
copy('public/index.php');
copy('resources/views');
copy('bootstrap/app.php');
copy('bootstrap/providers.php');
mkdirSync(join(stage, 'backend', 'bootstrap', 'cache'), { recursive: true });
// Start from the dev vendor so no network is needed; composer then removes every dev package
cpSync(join(backendSrc, 'vendor'), join(stage, 'backend', 'vendor'), { recursive: true });

const php = join(phpDir, 'php.exe');
const composer = ['composer.phar'].map((f) => join(phpDir, f)).find(existsSync);
if (!composer) throw new Error('composer.phar not found next to php.exe');
log('composer install --no-dev (removes dev packages from the copied vendor)');
execFileSync(php, ['-d', 'memory_limit=1G', composer, 'install', '--no-dev', '--optimize-autoloader', '--classmap-authoritative', '--no-scripts', '--no-interaction', '--no-progress'], {
  cwd: join(stage, 'backend'),
  stdio: 'inherit',
});

// ------------------------------------------------------------------ php runtime
const dlls = ['php.exe', 'php8ts.dll', 'libcrypto-3-x64.dll', 'libssl-3-x64.dll', 'libsqlite3.dll', 'license.txt'];
dlls.forEach((f) => cpSync(join(phpDir, f), join(stage, 'php', f)));
['php_mbstring.dll', 'php_openssl.dll', 'php_pdo_sqlite.dll', 'php_sqlite3.dll', 'php_fileinfo.dll', 'php_opcache.dll'].forEach((f) =>
  cpSync(join(phpDir, 'ext', f), join(stage, 'php', 'ext', f))
);
// App-local copy of the Visual C++ runtime PHP needs, so a PC without it still works
const sys32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].forEach((f) => {
  if (existsSync(join(sys32, f))) cpSync(join(sys32, f), join(stage, 'php', f));
  else log(`WARNING: ${f} not found in System32; target PCs need the VC++ 2015-2022 runtime`);
});

// ------------------------------------------------------------------ demo database (DEMO installer only)
// Always create the folder (electron-builder packs it); it holds a database only when FOODCOURT_DEMO_DATA=1.
// The clean installer therefore ships an empty folder and the app behaves exactly as before.
mkdirSync(join(stage, 'demo'), { recursive: true });
if (process.env.FOODCOURT_DEMO_DATA === '1') {
  const demoDb = join(stage, 'demo', 'foodcourt-demo.sqlite');
  writeFileSync(demoDb, '');
  const env = {
    ...process.env,
    APP_ENV: 'production',
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: demoDb,
    DB_FOREIGN_KEYS: 'true',
    CACHE_STORE: 'array',
    SESSION_DRIVER: 'array',
    QUEUE_CONNECTION: 'sync',
    BROADCAST_CONNECTION: 'null',
  };
  // Runs the SAME migrations and the real closing/payout code from the source backend, into a throw-away SQLite file
  log('building the demo-data database (migrations + foodcourt:seed-payout-demo)');
  execFileSync(php, ['artisan', 'migrate', '--force', '--no-interaction'], { cwd: backendSrc, env, stdio: 'inherit' });
  execFileSync(php, ['artisan', 'foodcourt:seed-payout-demo', '--no-interaction'], { cwd: backendSrc, env, stdio: 'inherit' });
  log(`demo database ${(statSync(demoDb).size / 1048576).toFixed(1)} MB -> ${demoDb}`);
}

cpSync(join(here, 'embedded-router.php'), join(stage, 'router.php'));
writeFileSync(join(stage, 'README.txt'), 'Generated by scripts/prepare-embedded-server.mjs. Do not edit; not committed.\n');
log(`backend ${sizeMb(join(stage, 'backend'))} MB, php ${sizeMb(join(stage, 'php'))} MB -> ${stage}`);
