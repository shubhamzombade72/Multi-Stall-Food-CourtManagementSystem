/**
 * "Connect to an existing food court", driven through the real Electron runtime against a real shared host:
 * a separate Laravel process on PostgreSQL's test database with pairing required, as multi-pc-deployment.md describes.
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/connect-host.e2e.mjs
 *   PACKAGED_ASAR=<win-unpacked>/resources/app.asar FOODCOURT_SERVER_DIR=<win-unpacked>/resources/server node e2e/connect-host.e2e.mjs
 *
 * Covers both ways in: the Welcome screen of a new install, and the sign-in screen of a PC that already has an account.
 * Uses temporary profiles and reseeds foodcourt_test_db only.
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const BACKEND = resolve(APP_DIR, '..', 'backend');
const PORT = 8123;
const HOST_API = `http://127.0.0.1:${PORT}/api`;
const SEEDED_OWNER = { email: 'owner@foodcourt.com', password: 'password123' };
const LINK_WELCOME = 'Connect to an existing food court instead';
const LINK_SIGN_IN = 'Connect to an existing food court';

const hostEnv = {
  ...process.env,
  APP_ENV: 'testing',
  APP_DEBUG: 'false',
  DB_DATABASE: 'foodcourt_test_db',
  FOODCOURT_EMBEDDED: 'false',
  FOODCOURT_REQUIRE_PAIRING: 'true',
  FOODCOURT_PUBLIC_API_URL: HOST_API,
};
const artisan = (...args) => execFileSync('php', ['artisan', ...args], { cwd: BACKEND, env: hostEnv, encoding: 'utf8' });
const newCode = () => {
  const match = artisan('foodcourt:pairing-code').match(/FCPAIR1\.[A-Za-z0-9_\-=+/]+/);
  if (!match) throw new Error('The host did not print a connection code');
  return match[0];
};

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const pageErrors = [];
const profiles = [];
const newProfile = () => {
  const p = mkdtempSync(join(tmpdir(), 'foodcourt-connect-'));
  profiles.push(p);
  return p;
};
const launch = async (profile) => {
  const target = { executablePath: electronPath, args: [process.env.PACKAGED_ASAR || APP_DIR] };
  const env = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...target, env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  return { app, page };
};
const appears = (locator, timeout = 8000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
const config = (page) => page.evaluate(() => window.desktop.getConfig());
const hash = (page) => page.evaluate(() => location.hash);
const signInButton = (page) => page.getByRole('button', { name: /Sign In to Food Court/ });

const connectAndSignIn = async (page, code, idPrefix) => {
  await page.fill('#pair-code', code);
  await page.getByRole('button', { name: 'Connect this computer' }).click();
  check(`${idPrefix}-1`, 'A valid code connects and lands on the sign-in screen', await appears(signInButton(page), 30000), await hash(page));
  const cfg = await config(page);
  check(`${idPrefix}-2`, 'The app now uses the shared host, not its built-in server', cfg.apiBaseUrl === HOST_API && cfg.mode === 'remote' && cfg.paired === true, `${cfg.mode} ${cfg.apiBaseUrl} paired=${cfg.paired}`);
  await page.fill('input[type="email"]', SEEDED_OWNER.email);
  await page.fill('input[type="password"]', SEEDED_OWNER.password);
  await signInButton(page).click();
  const signedIn = await page.waitForFunction(() => document.querySelector('aside nav'), null, { timeout: 30000 }).then(() => true, () => false);
  const alert = signedIn ? '' : await page.getByRole('alert').first().innerText().catch(() => '');
  check(`${idPrefix}-3`, 'The owner signs in through the shared host', signedIn, signedIn ? await hash(page) : alert);
};

let host;
let session;
const closeSession = async () => {
  if (session) await session.app.close().catch(() => undefined);
  session = null;
};

try {
  // ------------------------------------------------------------------ a real shared host
  artisan('migrate:fresh', '--seed', '--force');
  // Laravel's router looks for index.php in the current folder, so the host runs from public/
  const router = join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php');
  host = spawn('php', ['-S', `127.0.0.1:${PORT}`, router], { cwd: join(BACKEND, 'public'), env: hostEnv, stdio: 'ignore' });
  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline && !up) {
    up = await fetch(`${HOST_API}/system/ready`, { headers: { Accept: 'application/json' } }).then((r) => r.ok && (r.headers.get('content-type') || '').includes('json'), () => false);
    if (!up) await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) throw new Error('The test host did not start');
  const refused = await fetch(`${HOST_API}/auth/login`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(SEEDED_OWNER) });
  check('H-01', 'Precondition: the host refuses sign-in from a computer that is not connected', refused.status === 403 && (await refused.json()).code === 'device_not_paired', `HTTP ${refused.status}`);

  // ------------------------------------------------------------------ way in 1: Welcome screen of a new install
  const fresh = newProfile();
  session = await launch(fresh);
  let page = session.page;
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.getByRole('link', { name: LINK_WELCOME }).click();
  const opened = await appears(page.locator('#pair-code'));
  check('W-01', 'The Welcome link opens the connection page', opened, await hash(page));
  if (!opened) throw new Error('The connection page did not open');

  await page.getByRole('link', { name: /Back/ }).click();
  check('W-02', 'Back returns a new install to the Welcome screen', await appears(page.locator('#owner-name')), await hash(page));
  await page.getByRole('link', { name: LINK_WELCOME }).click();
  await page.locator('#pair-code').waitFor({ timeout: 8000 });

  await page.fill('#pair-code', 'not-a-real-code');
  await page.getByRole('button', { name: 'Connect this computer' }).click();
  const badCode = await appears(page.getByRole('alert'));
  check('W-03', 'A wrong code shows a clear message and stays on the page', badCode && await page.locator('#pair-code').isVisible(), badCode ? await page.getByRole('alert').first().innerText() : 'no message');

  await connectAndSignIn(page, newCode(), 'W-04');
  await closeSession();

  session = await launch(fresh);
  page = session.page;
  const stillRemote = await appears(signInButton(page), 30000) || await appears(page.locator('aside nav'), 5000);
  const afterRestart = await config(page);
  check('W-05', 'After a restart the computer is still connected to the shared host', stillRemote && afterRestart.mode === 'remote' && afterRestart.apiBaseUrl === HOST_API, `${afterRestart.mode} ${afterRestart.apiBaseUrl}`);
  await closeSession();

  // ------------------------------------------------------------------ way in 2: sign-in screen, this PC already has an account
  const existing = newProfile();
  session = await launch(existing);
  page = session.page;
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Local Owner');
  await page.fill('#owner-email', 'local.owner@example.com');
  await page.fill('#owner-password', 'Str0ngPass99');
  await page.fill('#owner-confirm', 'Str0ngPass99');
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  await page.evaluate(() => {
    localStorage.removeItem('fc_auth_token');
    localStorage.removeItem('fc_auth_user');
    location.hash = '#/login';
    location.reload();
  });
  await signInButton(page).waitFor({ timeout: 30000 });
  const link = page.getByRole('link', { name: LINK_SIGN_IN });
  check('S-01', 'The sign-in screen offers the connect option', await appears(link));
  await link.click();
  const openedFromSignIn = await appears(page.locator('#pair-code'));
  check('S-02', 'The sign-in link opens the connection page', openedFromSignIn, await hash(page));
  if (!openedFromSignIn) throw new Error('The connection page did not open from the sign-in screen');
  await page.getByRole('link', { name: /Back/ }).click();
  check('S-03', 'Back returns to the sign-in screen when the PC has an account', await appears(signInButton(page)), await hash(page));
  await link.click();
  await page.locator('#pair-code').waitFor({ timeout: 8000 });
  await connectAndSignIn(page, newCode(), 'S-04');
  check('S-05', "The PC's own database is left in place", existsSync(join(existing, 'server', 'foodcourt.sqlite')));
  await page.evaluate(() => {
    localStorage.removeItem('fc_auth_token');
    localStorage.removeItem('fc_auth_user');
    location.hash = '#/login';
    location.reload();
  });
  await signInButton(page).waitFor({ timeout: 30000 });
  check('S-06', 'A computer already connected to a host does not offer connecting again', !(await page.getByRole('link', { name: LINK_SIGN_IN }).isVisible()));

  check('Z-01', 'No uncaught page errors during the run', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('ABORT', 'The script stopped early', false, err?.stack || err);
} finally {
  await closeSession();
  if (host) host.kill();
  await new Promise((r) => setTimeout(r, 1500));
  for (const p of profiles) rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
