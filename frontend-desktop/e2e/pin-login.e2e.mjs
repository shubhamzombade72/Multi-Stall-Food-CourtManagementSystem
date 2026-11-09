/**
 * PIN sign-in, driven through the real Electron runtime, real Windows DPAPI and the built-in server, on a throw-away
 * profile. Part 2 uses a small stand-in server to show what happens when the server stops answering after a correct PIN.
 *
 *   cd frontend-desktop && pnpm build
 *   node e2e/pin-login.e2e.mjs
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 140)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-pin-'));
const vaultFile = join(profile, 'auth-vault.json');
const EMAIL = 'pin.owner@example.com';
const PASSWORD = 'Str0ngPass99';
const PIN = '482916';
const PIN2 = '7391';
const PIN3 = '305871';
const WRONG = '111112';

const launch = (extraEnv = {}, dir = profile) =>
  electron.launch({
    args: [APP_DIR],
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: dir, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '', FOODCOURT_PIN_LOCK: '', ...extraEnv },
    timeout: 60000,
  });

let app;
let page;
const start = async (extraEnv, dir) => {
  app = await launch(extraEnv, dir);
  page = await app.firstWindow();
};
const stop = async () => {
  if (app) await app.close();
  app = null;
  await new Promise((r) => setTimeout(r, 800));
};
const restart = async (extraEnv, dir) => {
  await stop();
  await start(extraEnv, dir);
};

const keypad = (p = page) => p.getByTestId('pin-key-0');
const waitForPinScreen = (p = page) => keypad(p).waitFor({ timeout: 60000 });
const enterOnKeypad = async (pin, p = page) => {
  for (const d of pin) await p.getByTestId(`pin-key-${d}`).click();
  await p.getByRole('button', { name: 'Unlock' }).click();
};
const waitForDelayToEnd = () => page.waitForFunction(() => !document.querySelector('[data-testid="pin-wait"]'), null, { timeout: 30000 });
const onDashboard = () => page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 30000 });
const signIn = async (password = PASSWORD, email = EMAIL) => {
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.getByRole('button', { name: /Sign In/ }).click();
  // This journey signs in faster than a person does: wait out the server's limit of 5 sign-ins a minute
  const limited = await page.getByText('Too many sign-in attempts').waitFor({ timeout: 2500 }).then(() => true, () => false);
  if (limited) {
    await page.waitForTimeout(61000);
    await page.getByRole('button', { name: /Sign In/ }).click();
  }
};
const createPin = async (pin) => {
  await page.locator('#pin-new').waitFor({ timeout: 30000 });
  if (pin.length === 4) await page.getByRole('button', { name: '4 digits' }).click();
  await page.fill('#pin-new', pin);
  await page.fill('#pin-confirm', pin);
  await page.getByRole('button', { name: /Save PIN/ }).click();
};
const storedToken = () => page.evaluate(() => localStorage.getItem('fc_auth_token'));
const apiBase = () => page.evaluate(async () => (await window.desktop.getConfig()).apiBaseUrl);
const bodyText = () => page.evaluate(() => document.body.innerText);

try {
  // ------------------------------------------------------------------ first time
  await start();
  await page.locator('#owner-name').waitFor({ timeout: 60000 });
  await page.fill('#owner-name', 'Pin Owner');
  await page.fill('#owner-email', EMAIL);
  await page.fill('#owner-password', PASSWORD);
  await page.fill('#owner-confirm', PASSWORD);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  check('P-00', 'A new owner still sees the one-time recovery key first (PIN setup does not replace it)', true);
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('#pin-new').waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shots, 'pin-setup.png') });
  check('P-01', 'Fresh install: after the account is created the PIN setup screen appears before the app', !/dashboard/i.test(await page.evaluate(() => location.hash)));

  await page.fill('#pin-new', '123456');
  await page.fill('#pin-confirm', '123456');
  await page.getByRole('button', { name: /Save PIN/ }).click();
  check('P-02a', 'A simple sequence is refused', await page.getByText(/too easy to guess/).isVisible());
  await page.fill('#pin-new', PIN);
  await page.fill('#pin-confirm', PIN3);
  await page.getByRole('button', { name: /Save PIN/ }).click();
  check('P-02b', 'Two different PINs are refused', await page.getByText('The two PINs do not match.').isVisible());
  await page.fill('#pin-new', '12ab');
  check('P-02c', 'The PIN field accepts digits only', (await page.inputValue('#pin-new')) === '12');
  await createPin(PIN);
  await onDashboard();
  check('P-02', 'Valid PIN: saved, and the dashboard opens', true);

  const file = readFileSync(vaultFile, 'utf8');
  check('P-03a', 'The saved file contains no readable PIN, token or email', !file.includes(PIN) && !/\d+\|[A-Za-z0-9]{20,}/.test(file) && !file.includes(EMAIL));
  check('P-03b', 'The token is not in browser storage', (await storedToken()) === null);

  // ------------------------------------------------------------------ every next time
  await restart();
  await waitForPinScreen();
  const pinScreen = await bodyText();
  await page.screenshot({ path: join(shots, 'pin-login.png') });
  check('P-04', 'Reopening shows the PIN screen with the account, and asks for no email or password', /Welcome Back/.test(pinScreen) && pinScreen.includes(EMAIL) && (await page.locator('input[type=password],input[type=email]').count()) === 0);
  check('P-04b', 'All keypad digits, backspace, Unlock and Forgot PIN are there; 6 masked dots', (await page.locator('[data-testid^="pin-key-"]').count()) === 10 && (await page.getByTestId('pin-backspace').count()) === 1 && (await page.getByRole('button', { name: 'Unlock' }).count()) === 1 && (await page.getByRole('button', { name: 'Forgot PIN?' }).count()) === 1 && (await page.locator('[data-testid="pin-dots"] > span').count()) === 6);

  await page.evaluate(() => {
    location.hash = '#/staff';
  });
  await page.waitForTimeout(300);
  check('P-04c', 'Going to an address behind the lock still shows only the PIN screen', (await keypad().isVisible()) && !/Staff & Permissions/.test(await bodyText()));

  await enterOnKeypad(PIN);
  await page.waitForFunction(() => !document.querySelector('[data-testid="pin-key-0"]'), null, { timeout: 30000 });
  await page.evaluate(() => {
    location.hash = '#/dashboard';
  });
  await onDashboard();
  check('P-05', 'The correct PIN opens the app', /Dashboard/.test(await bodyText()) && (await page.locator('input[type=password]').count()) === 0);

  // ------------------------------------------------------------------ lock
  await page.getByRole('button', { name: /^Lock/ }).click();
  await waitForPinScreen();
  check('P-06', 'Lock returns to the PIN screen and the app is no longer on screen', !/Dashboard/.test(await bodyText()));
  check('P-06b', 'Lock keeps the saved sign-in', existsSync(vaultFile));
  await page.keyboard.type(PIN.slice(0, 5));
  await page.keyboard.press('Backspace');
  check('P-07a', 'Keyboard digits and backspace work', (await page.locator('[data-testid="pin-dots"] > span[data-filled="true"]').count()) === 4);
  await page.keyboard.type(PIN.slice(4));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('[data-testid="pin-key-0"]'), null, { timeout: 30000 });
  check('P-07', 'The Enter key submits, and the same PIN unlocks after a lock', true);
  await page.getByRole('button', { name: /^Lock/ }).click();
  await waitForPinScreen();

  // ------------------------------------------------------------------ wrong PIN, lockout
  await enterOnKeypad(WRONG);
  await page.getByText(/Incorrect PIN\. 4 attempts left/).waitFor({ timeout: 15000 });
  check('P-08', 'A wrong PIN is denied with clear feedback', (await keypad().isVisible()));
  check('P-08b', 'Keys are disabled during the wait after a wrong PIN', await keypad().isDisabled());
  for (let left = 3; left >= 1; left -= 1) {
    await waitForDelayToEnd();
    await enterOnKeypad(WRONG);
    await page.getByText(new RegExp(`Incorrect PIN\\. ${left} attempt`)).waitFor({ timeout: 15000 });
  }
  await waitForDelayToEnd();
  await enterOnKeypad(WRONG);
  await page.getByText(/temporarily locked/).waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(shots, 'pin-locked.png') });
  check('P-09', 'Five wrong PINs lock PIN sign-in, with a countdown', /Try again in 4 minutes|Try again in 5 minutes/.test(await bodyText()), await page.getByTestId('pin-wait').innerText());

  await restart();
  await waitForPinScreen();
  await page.getByTestId('pin-wait').waitFor({ timeout: 10000 });
  check('P-09b', 'Restarting the app does not clear the lock', await keypad().isDisabled(), await page.getByTestId('pin-wait').innerText());
  const directTry = await page.evaluate((pin) => window.desktop.authVaultUnlock(pin), PIN);
  check('P-09c', 'Calling the main process directly with the right PIN during the lock is refused too', directTry.ok === false && directTry.code === 'locked' && !directTry.token, directTry.code);

  // ------------------------------------------------------------------ forgot PIN
  await page.getByRole('button', { name: 'Forgot PIN?' }).click();
  await page.getByText('Forgot PIN? Re-authenticate to reset your PIN.').waitFor({ timeout: 10000 });
  check('P-10a', 'Forgot PIN asks for the password and fixes the email to this account', (await page.inputValue('input[type=email]')) === EMAIL && (await page.locator('input[type=email]').getAttribute('readonly')) !== null);
  await page.getByRole('button', { name: 'Back to PIN' }).click();
  await waitForPinScreen();
  await page.getByRole('button', { name: 'Forgot PIN?' }).click();
  await page.fill('input[type=password]', 'Wrong-pass-1');
  await page.getByRole('button', { name: /Verify and reset/ }).click();
  await page.getByText(/Invalid email or password|do not match/).waitFor({ timeout: 15000 });
  check('P-10b', 'A wrong password does not reset the PIN', await page.locator('#pin-new').count() === 0 && existsSync(vaultFile));
  await page.fill('input[type=password]', PASSWORD);
  await page.getByRole('button', { name: /Verify and reset/ }).click();
  await createPin(PIN2);
  await onDashboard();
  check('P-10', 'Forgot PIN: password, then a new PIN, then the dashboard (works during a lock)', true);

  await restart();
  await waitForPinScreen();
  check('P-11a', 'The new PIN length is used on the PIN screen', (await page.locator('[data-testid="pin-dots"] > span').count()) === 4);
  const oldPin = await page.evaluate((pin) => window.desktop.authVaultUnlock(pin), PIN);
  check('P-11b', 'The old PIN no longer works', oldPin.ok === false);
  await enterOnKeypad(PIN2);
  await page.waitForFunction(() => !document.querySelector('[data-testid="pin-key-0"]'), null, { timeout: 30000 });
  check('P-11', 'The new PIN works', true);

  // ------------------------------------------------------------------ server refuses the session
  await restart();
  await waitForPinScreen();
  const api = await apiBase(); // the built-in server's port changes on each launch
  const elsewhere = await page.evaluate(async ({ api, email, password }) => {
    const r = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) });
    return r.status;
  }, { api, email: EMAIL, password: PASSWORD });
  check('P-12a', 'Signing in elsewhere revoked the session saved on this PC (setup for the next step)', elsewhere === 200, elsewhere);
  await enterOnKeypad(PIN2);
  await page.getByText('Your session has expired. Please sign in again.').waitFor({ timeout: 30000 });
  check('P-12', 'Correct PIN + revoked session: the password is required; the PIN alone does not open the app', (await page.locator('input[type=password]').count()) === 1 && !/Dashboard/.test(await bodyText()));
  check('P-12b', 'The dead session is removed from this PC', !existsSync(vaultFile));
  await signIn();
  await createPin(PIN3);
  await onDashboard();
  check('P-12c', 'Signing in again and choosing a PIN recovers normally', true);

  // ------------------------------------------------------------------ second launch
  const electronPath = createRequire(import.meta.url)('electron');
  const second = spawn(electronPath, [APP_DIR], { env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_API_URL: '', FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: '' }, stdio: 'ignore' });
  const secondExit = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('still running'), 20000);
    second.on('exit', (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
  if (secondExit === 'still running') second.kill();
  check('P-13', 'A second launch hands over and exits; the first stays signed in', secondExit !== 'still running' && /Dashboard/.test(await bodyText()), `second launch exit: ${secondExit}`);

  // Two quick submits count as one attempt
  await page.getByRole('button', { name: /^Lock/ }).click();
  await waitForPinScreen();
  await page.keyboard.type(WRONG);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByText(/Incorrect PIN\. 4 attempts left/).waitFor({ timeout: 15000 });
  check('P-13b', 'A double Enter counts as one attempt', true);
  await waitForDelayToEnd();

  // ------------------------------------------------------------------ damaged storage
  await stop();
  writeFileSync(vaultFile, 'this is not a vault');
  await start();
  await page.getByText('The saved sign-in on this computer could not be read. Please sign in again.').waitFor({ timeout: 60000 });
  check('P-14a', 'A damaged file: no crash, a plain message, and the password screen', (await page.locator('input[type=password]').count()) === 1 && !existsSync(vaultFile));
  await signIn();
  await createPin(PIN);
  await onDashboard();
  const outer = JSON.parse(readFileSync(vaultFile, 'utf8'));
  const bytes = Buffer.from(outer.sealed, 'base64');
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  await stop();
  writeFileSync(vaultFile, JSON.stringify({ ...outer, sealed: bytes.toString('base64') }));
  await start();
  await page.getByText('The saved sign-in on this computer could not be read. Please sign in again.').waitFor({ timeout: 60000 });
  check('P-14b', 'One changed byte (real Windows DPAPI refuses it): treated the same, nothing is trusted', !existsSync(vaultFile));
  await signIn();
  await createPin(PIN);
  await onDashboard();

  // ------------------------------------------------------------------ full logout
  await page.locator('header button').last().click();
  await page.getByRole('button', { name: /Sign In/ }).waitFor({ timeout: 15000 });
  check('P-15', 'Full logout returns to the password screen and removes the PIN', !existsSync(vaultFile));
  await restart();
  await page.getByRole('button', { name: /Sign In/ }).waitFor({ timeout: 60000 });
  check('P-15b', 'After a full logout, reopening still needs the password', (await page.getByTestId('pin-key-0').count()) === 0);

  // ------------------------------------------------------------------ installs from before PINs existed
  await restart({ FOODCOURT_PIN_LOCK: 'off' });
  await page.getByRole('button', { name: /Sign In/ }).waitFor({ timeout: 60000 });
  await signIn();
  await onDashboard();
  check('P-16a', 'An older-version session sits in browser storage (setup for the next step)', Boolean(await storedToken()));
  await restart();
  await page.locator('#pin-new').waitFor({ timeout: 60000 });
  check('P-16', 'Upgrading: the existing account goes straight to choosing a PIN, with no password and no data change', (await page.locator('input[type=email]').count()) === 0);
  check('P-16b', 'Upgrading moves the token out of browser storage', (await storedToken()) === null);
  await createPin(PIN);
  await onDashboard();
  check('P-16c', 'The upgraded account opens the app', true);
  await restart();
  await waitForPinScreen();
  await page.getByRole('button', { name: 'Use a different account' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await page.getByRole('button', { name: /Sign In/ }).waitFor({ timeout: 15000 });
  check('P-17', 'Use a different account: the saved sign-in is removed and the password screen is shown', !existsSync(vaultFile));
  await stop();

  // ------------------------------------------------------------------ the server stops answering after a correct PIN
  let meStatus = 200;
  const stub = createServer((req, res) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
    const user = { id: 1, name: 'Stub Owner', email: 'stub@example.com', role: 'waiter', phone: null, stall_id: null, stall: null };
    if (req.url.endsWith('/auth/me') && meStatus !== 200) return res.writeHead(meStatus, headers).end('{}');
    if (req.url.endsWith('/auth/login')) return res.writeHead(200, headers).end(JSON.stringify({ success: true, data: { token: '1|stubstubstubstubstub', user } }));
    if (req.url.endsWith('/auth/me')) return res.writeHead(200, headers).end(JSON.stringify({ success: true, data: { user } }));
    return res.writeHead(200, headers).end(JSON.stringify({ success: true, data: [] }));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const stubApi = `http://127.0.0.1:${stub.address().port}/api`;
  const stubProfile = mkdtempSync(join(tmpdir(), 'foodcourt-pin-stub-'));
  try {
    await start({ FOODCOURT_API_URL: stubApi }, stubProfile);
    await page.getByRole('button', { name: /Sign In/ }).waitFor({ timeout: 60000 });
    await signIn('anything-1', 'stub@example.com');
    await createPin(PIN);
    await page.waitForFunction(() => /tracking/.test(location.hash), null, { timeout: 15000 });
    await restart({ FOODCOURT_API_URL: stubApi }, stubProfile);
    await waitForPinScreen();
    meStatus = 503;
    await enterOnKeypad(PIN);
    await page.getByText(/PIN is correct, but the food court system is not responding/).waitFor({ timeout: 30000 });
    check('P-18', 'Correct PIN + server not answering: a plain error, the app stays closed, the saved sign-in stays', !/Orders & Table Tracking/.test(await bodyText()) && existsSync(join(stubProfile, 'auth-vault.json')));
    meStatus = 200;
    await page.getByRole('button', { name: 'Try again' }).click();
    await waitForPinScreen();
    await enterOnKeypad(PIN);
    await page.waitForFunction(() => /tracking/.test(location.hash) && !document.querySelector('[data-testid="pin-key-0"]'), null, { timeout: 30000 });
    check('P-18b', 'Try again returns to the PIN and works once the server is back', true);
    await stop();
  } finally {
    stub.close();
    rmSync(stubProfile, { recursive: true, force: true });
  }
} catch (err) {
  check('P-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 3).join(' '));
  try {
    if (page) await page.screenshot({ path: join(shots, 'pin-failure.png') });
  } catch {}
} finally {
  try {
    if (app) await app.close();
  } catch {}
  await new Promise((r) => setTimeout(r, 800));
  const logFile = join(profile, 'logs', 'desktop.log');
  if (existsSync(logFile)) {
    const log = readFileSync(logFile, 'utf8');
    const leaked = [PASSWORD, PIN, PIN2, PIN3, WRONG, 'Bearer '].filter((s) => log.includes(s));
    check('P-LOG', 'The support log contains no PIN, password or token', leaked.length === 0 && !/\d+\|[A-Za-z0-9]{30,}/.test(log), `${log.split('\n').filter(Boolean).length} lines; found: ${leaked.length}`);
  }
  writeFileSync(join(shots, 'pin-login-results.json'), JSON.stringify(results, null, 2));
  rmSync(profile, { recursive: true, force: true });
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
