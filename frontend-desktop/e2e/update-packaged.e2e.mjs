/**
 * The installed form of the app: the real `MangalMurti POS.exe`, not `electron <asar>`. It has `app.isPackaged` true, so it uses
 * the trust file and service address inside its own files and ignores every test setting. This script therefore builds a throw-away
 * package with a throw-away public key and the local service address inside, then updates it through the UI.
 *
 * LOCALAPPDATA and the profile are pointed at a temp folder, so no real install or profile is touched. Inputs:
 *   UPDATE_E2E_DIST=<dist>  UPDATE_E2E_SERVER=<prepared server folder>  node e2e/update-packaged.e2e.mjs
 */
import { _electron as electron } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(DESKTOP, '..', 'backend');
const DIST = resolve(process.env.UPDATE_E2E_DIST || join(DESKTOP, 'dist'));
const SERVER = resolve(process.env.UPDATE_E2E_SERVER || join(DESKTOP, 'build-server'));

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 180)}]` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000, every = 500) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  return last;
};
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const freePort = () => new Promise((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});
const killPid = (pid) => {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
};

const T = mkdtempSync(join(tmpdir(), 'fc-update-pkg-'));
const keyFile = join(T, 'key.pem');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const publicB64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const port = await freePort();
const SERVICE = `http://127.0.0.1:${port}/api`;

// ------------------------------------------------------------------ a package configured the way a release would be
const electronCopy = join(T, 'electron');
cpSync(join(DESKTOP, 'electron'), electronCopy, { recursive: true });
writeFileSync(join(electronCopy, 'update-trust.json'), JSON.stringify({ keys: { pkg: publicB64 } }));
writeFileSync(join(electronCopy, 'app-config.json'), JSON.stringify({ apiBaseUrl: '', updateServerUrl: SERVICE }));
const config = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).build;
config.directories.output = join(T, 'out');
config.files = [{ from: DIST, to: 'dist' }, { from: electronCopy, to: 'electron' }, 'package.json', '!node_modules/**/*'];
config.extraResources = ['php', 'backend', 'router.php'].map((n) => ({ from: join(SERVER, n), to: `server/${n}` }));
const configFile = join(T, 'pack.json');
writeFileSync(configFile, JSON.stringify(config));
console.log('[packaged] building...');
const builder = spawnSync('npx', ['electron-builder', '--win', '--x64', '--dir', '--config', `"${configFile}"`], { cwd: DESKTOP, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
const UNPACKED = join(T, 'out', 'win-unpacked');
const EXE = join(UNPACKED, 'MangalMurti POS.exe');
if (!existsSync(EXE)) {
  console.error(builder.stdout?.slice(-1500), builder.stderr?.slice(-1500));
  process.exit(2);
}

// Smart App Control refuses a freshly built unsigned exe on a PC where it is on. The Electron binary is the same for every
// build of a version, so an exe Windows already allows can run these resources: pass it as UPDATE_E2E_HOST_EXE.
if (process.env.UPDATE_E2E_HOST_EXE) cpSync(resolve(process.env.UPDATE_E2E_HOST_EXE), EXE);

// ------------------------------------------------------------------ update service
const serviceDb = join(T, 'service.sqlite');
writeFileSync(serviceDb, '');
const serviceEnv = { ...process.env, APP_ENV: 'production', APP_DEBUG: 'false', APP_KEY: `base64:${randomBytes(32).toString('base64')}`, DB_CONNECTION: 'sqlite', DB_DATABASE: serviceDb, CACHE_STORE: 'file', SESSION_DRIVER: 'array', QUEUE_CONNECTION: 'sync', BROADCAST_CONNECTION: 'null', FOODCOURT_EMBEDDED: 'false', FOODCOURT_UPDATE_SERVICE: 'true', FOODCOURT_UPDATE_TRUSTED_KEYS: `pkg:${publicB64}`, FOODCOURT_UPDATE_STORAGE: join(T, 'service-packages'), LOG_CHANNEL: 'null' };
const art = (...a) => execFileSync('php', ['artisan', ...a, '--no-interaction'], { cwd: BACKEND, env: serviceEnv, encoding: 'utf8' });
art('migrate', '--force');
art('tinker', '--execute', "\\App\\Models\\User::create(['name'=>'Release Owner','email'=>'release.owner@example.test','password'=>'Str0ngPass99','role'=>'owner','is_active'=>true]);");
const service = spawn('php', ['-S', `127.0.0.1:${port}`, join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php')], { cwd: join(BACKEND, 'public'), env: serviceEnv, stdio: 'ignore', windowsHide: true });
const http = async (method, url, { token, body } = {}) => {
  const res = await fetch(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// ------------------------------------------------------------------ throw-away Windows locations
const localAppData = join(T, 'local');
const profile = join(T, 'profile');
mkdirSync(localAppData);
mkdirSync(profile);
const updateRoot = join(localAppData, 'MangalMurti POS Updates');
const ignoredRoot = join(T, 'ignored-root');
const env = {
  ...process.env,
  LOCALAPPDATA: localAppData,
  FOODCOURT_USER_DATA_DIR: profile,
  FOODCOURT_UPDATE_FIRST_CHECK_MS: '3600000',
  FOODCOURT_FIRST_BACKUP_DELAY_MS: '3600000',
  // All of these must have no effect in an installed app
  FOODCOURT_UPDATE_ROOT: ignoredRoot,
  FOODCOURT_UPDATE_TRUST: join(T, 'attacker-trust.json'),
  FOODCOURT_UPDATE_URL: 'http://attacker.invalid/api',
  FOODCOURT_PIN_LOCK: 'off',
  FOODCOURT_SMOKE_TEST: '',
  FOODCOURT_API_URL: '',
};
writeFileSync(join(T, 'attacker-trust.json'), JSON.stringify({ keys: { attacker: 'AAAA' } }));
const processes = [];
let failed = false;

try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/up`).catch(() => null))?.status === 200, 30000);
  const adminToken = (await http('POST', `${SERVICE}/auth/login`, { body: { email: 'release.owner@example.test', password: 'Str0ngPass99' } })).json.data.token;

  // Smoke test: the existing security self-check, on the real exe, now going through the loader
  const smoke = spawnSync(EXE, [], { env: { ...env, FOODCOURT_SMOKE_TEST: '1', FOODCOURT_USER_DATA_DIR: join(T, 'smoke-profile') }, encoding: 'utf8', timeout: 120000 });
  const line = /SMOKE_RESULT (.*)/.exec(smoke.stdout || '')?.[1];
  const parsed = line ? JSON.parse(line) : null;
  check('PKG-01', 'Security self-check passes on the real exe, including the bridge allow-list and no DevTools', parsed?.pass === true && parsed.packaged === true, line ? JSON.stringify({ packaged: parsed.packaged, version: parsed.version, devToolsOff: parsed.devToolsOff, bridge: parsed.bridgeAllowlist }) : `exit ${smoke.status} ${smoke.error || ''}`);

  // Baseline and a real next version
  const STORE = join(T, 'store');
  const base = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/baseline.mjs'), '--from-unpacked', UNPACKED, '--version', '1.2.0', '--store', STORE, '--electron-major', '44'], { encoding: 'utf8' });
  check('PKG-02', 'Baseline taken from the real installed files', base.status === 0, base.stderr);
  const tree = join(T, 'tree');
  mkdirSync(join(tree, 'app'), { recursive: true });
  cpSync(DIST, join(tree, 'app', 'dist'), { recursive: true });
  cpSync(electronCopy, join(tree, 'app', 'electron'), { recursive: true });
  writeFileSync(join(tree, 'app', 'package.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')), version: '1.3.0' }));
  cpSync(join(UNPACKED, 'resources', 'server'), join(tree, 'server'), { recursive: true });
  const index = join(tree, 'app', 'dist', 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace('<head>', '<head>\n    <meta name="fc-update-marker" content="1.3.0" />'));
  const routes = join(tree, 'server', 'backend', 'routes', 'api.php');
  writeFileSync(routes, `${readFileSync(routes, 'utf8')}\nRoute::get('/release-marker', fn () => ['version' => '1.3.0']);\n`);
  writeFileSync(join(tree, 'server', 'backend', 'database', 'migrations', '2050_01_01_000000_pkg.php'), "<?php\n\nuse Illuminate\\Database\\Migrations\\Migration;\nuse Illuminate\\Database\\Schema\\Blueprint;\nuse Illuminate\\Support\\Facades\\Schema;\n\nreturn new class extends Migration\n{\n    public function up(): void\n    {\n        Schema::table('orders', function (Blueprint $t) { $t->string('pkg_note')->nullable(); });\n    }\n};\n");
  const built = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/build-release.mjs'), '--version', '1.3.0', '--baseline', '1.2.0', '--store', STORE, '--app-root', join(tree, 'app'), '--server-root', join(tree, 'server'), '--key', keyFile, '--key-id', 'pkg', '--electron-major', '44'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw new Error(built.stderr);
  const pub = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/publish-release.mjs'), '--server', SERVICE, '--version', '1.3.0', '--store', STORE, '--publish', '--deploy', 'all'], { encoding: 'utf8', env: { ...process.env, FOODCOURT_RELEASE_TOKEN: adminToken } });
  check('PKG-03', 'Next version built, signed and published', pub.status === 0, pub.stderr);

  // The real exe
  const app = await electron.launch({ executablePath: EXE, env, timeout: 120000 });
  processes.push(app.process().pid);
  const page = await app.firstWindow();
  check('PKG-04', 'Real exe starts through the loader', (await app.evaluate(({ app: a }) => a.isPackaged)) === true);
  const api = await waitFor(async () => (await page.evaluate(() => window.desktop.getConfig()).catch(() => null))?.apiBaseUrl, 90000);
  check('PKG-05', 'Its built-in server runs from the installed resources', Boolean(api), api);
  const owner = { email: 'pkg.owner@example.test', password: 'Str0ngPass99', name: 'Pkg Owner' };
  const setup = await http('POST', `${api}/setup/owner`, { body: { ...owner, password_confirmation: owner.password } });
  if (setup.status >= 300) throw new Error(`setup ${setup.status}`);
  await page.reload();
  // The installed app always uses the PIN lock: sign in with the password, then choose a PIN
  await page.waitForSelector('input[type=email]', { timeout: 60000 });
  await page.fill('input[type=email]', owner.email);
  await page.fill('input[type=password]', owner.password);
  await page.keyboard.press('Enter');
  await page.locator('#pin-new').waitFor({ timeout: 30000 });
  check('PKG-06', 'The installed app ignored the test switch for the PIN lock', true);
  await page.fill('#pin-new', '482916');
  await page.fill('#pin-confirm', '482916');
  await page.getByRole('button', { name: /Save PIN/ }).click();
  await waitFor(() => page.evaluate(() => /dashboard|pos/i.test(location.hash)).catch(() => false), 30000);
  await page.evaluate(() => {
    location.hash = '#/updates';
  });
  await page.getByTestId('updates-page').waitFor({ timeout: 20000 });
  check('PKG-07', 'Test overrides are ignored: updates use the bundled key and address', existsSync(join(updateRoot, 'state')) && !existsSync(ignoredRoot) && (await page.getByTestId('update-disabled').count()) === 0);

  const code = (await http('POST', `${SERVICE}/update-admin/enrollment-codes`, { token: adminToken })).json.data.code;
  await page.getByLabel('Update code').fill(code);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByRole('button', { name: 'Check now' }).click();
  await page.getByTestId('update-available-version').waitFor({ timeout: 30000 });
  check('PKG-08', 'Real exe sees the update', (await page.getByTestId('update-available-version').textContent()) === '1.3.0');
  const exited = new Promise((r) => app.process().once('exit', r));
  await page.getByTestId('update-now').click();
  await page.getByTestId('update-confirm-yes').click();
  await Promise.race([exited, sleep(180000)]);

  const active = join(updateRoot, 'state', 'active.json');
  const confirmed = await waitFor(() => (readJson(active)?.state === 'confirmed' ? readJson(active) : null), 240000, 1000);
  check('PKG-09', 'Installed, restarted by the bootstrapper and confirmed on the real exe', confirmed?.version === '1.3.0', JSON.stringify(readJson(active) ?? readJson(join(updateRoot, 'state', 'journal.json'))));
  if (!confirmed && existsSync(join(updateRoot, 'logs', 'update.log'))) console.log(readFileSync(join(updateRoot, 'logs', 'update.log'), 'utf8').slice(-2000));

  const clients = (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data;
  const verified = await waitFor(async () => (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data[0]?.verified_app_version === '1.3.0', 60000, 1000);
  check('PKG-10', 'Update service validated the completion', verified === true, clients[0]?.verified_app_version);
  const running = readJson(join(profile, 'server', 'server.pid'));
  const marker = await http('GET', `http://127.0.0.1:${running?.port}/api/release-marker`);
  check('PKG-11', 'Restarted exe serves the new backend from the release folder', marker.json?.version === '1.3.0', JSON.stringify(marker.json));
  check('PKG-12', 'Install folder unchanged, data folder separate', !existsSync(join(UNPACKED, 'resources', 'server', 'backend', 'database', 'migrations', '2050_01_01_000000_pkg.php')) && existsSync(join(profile, 'server', 'foodcourt.sqlite')));

  const log = readFileSync(join(updateRoot, 'logs', 'update.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const programPid = log.filter((l) => /Program running/.test(l.msg)).at(-1)?.pid;
  if (programPid) killPid(programPid);
  if (running?.pid) killPid(running.pid);
} catch (err) {
  failed = true;
  console.error(err);
  check('PKG', 'Script ran to the end', false, err.message);
}

for (const pid of processes) killPid(pid);
killPid(service.pid);
const bad = results.filter((r) => r.result === 'FAIL');
console.log(`\n${results.length - bad.length}/${results.length} passed`);
await sleep(2000);
rmSync(T, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(bad.length || failed ? 1 : 0);
