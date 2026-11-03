/**
 * UI journey of the Windows app on a brand-new profile, driven through the real Electron runtime with its
 * built-in server: startup screen -> Welcome -> recovery key -> backup -> sign out/in -> restart -> forgotten
 * password. Also checks that no screen shows an address, port or product/server terminology.
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/ui-first-run.e2e.mjs [path to the app executable or unpacked app dir]
 *
 * Default target is the unpackaged app (node_modules electron + this folder), which is what the packaged
 * installer contains. Pass the packaged .exe to test that instead (blocked on PCs with Smart App Control), or the
 * packaged resources/app.asar together with FOODCOURT_SERVER_DIR=<win-unpacked>/resources/server to run the exact
 * packaged code under the signed Electron runtime.
 */
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const EXE_ARG = process.argv[2];
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 140)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-ui-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results');
mkdirSync(shots, { recursive: true });
const PW = 'Str0ngPass99';
const EMAIL = 'Priya.Owner@Example.com';
const FORBIDDEN = /localhost|127\.0\.0\.1|:\d{4,5}|laravel|postgres|sqlite|artisan|api address|server address|health.?check|\/api\b/i;

const launch = () =>
  electron.launch({
    ...(EXE_ARG && !EXE_ARG.endsWith('.asar') ? { executablePath: EXE_ARG } : { args: [EXE_ARG || APP_DIR] }),
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '', FOODCOURT_FIRST_BACKUP_DELAY_MS: '4000' },
    timeout: 60000,
  });

const phpRunningFor = () => {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='php.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\').replace(/'/g, "''")}*' } | Measure-Object).Count`], { encoding: 'utf8' });
    return Number(out.trim());
  } catch {
    return -1;
  }
};

const bodyText = (page) => page.evaluate(() => document.body.innerText);
let app;
let page;

try {
  // ------------------------------------------------------------------ first launch
  app = await launch();
  page = await app.firstWindow();
  const seen = new Set();
  const sawStartup = await (async () => {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const t = await bodyText(page).catch(() => '');
      for (const phrase of ['Starting application', 'Preparing database', 'Connecting to food court services']) if (t.includes(phrase)) seen.add(phrase);
      if (/Welcome/.test(t)) return true;
      await page.waitForTimeout(100);
    }
    return false;
  })();
  check('U-01', 'Opens by itself to the Welcome screen (no server screen, nothing to configure)', sawStartup, [...seen].join(' > ') || 'startup steps too fast to observe');
  await page.screenshot({ path: join(shots, 'welcome.png') });
  check('U-02', 'Welcome screen shows no address, port, or server/database product names', !FORBIDDEN.test(await bodyText(page)), (await bodyText(page)).slice(0, 80).replace(/\s+/g, ' '));
  check('U-03', 'Welcome offers "connect to an existing food court" (multi-PC) and "restore from a backup" (new PC)', await page.getByText('Connect to an existing food court instead').isVisible() && await page.getByText(/Restore from a backup/).isVisible());

  // The scheduled daily backup ran by itself (first run after start is moved up to 4 s for this test)
  const backupDirPath = join(profile, 'server', 'backups');
  const autoDeadline = Date.now() + 40000;
  let autoFile = null;
  while (Date.now() < autoDeadline && !autoFile) {
    autoFile = (existsSync(backupDirPath) ? readdirSync(backupDirPath) : []).find((f) => f.startsWith('foodcourt-auto-') && f.endsWith('.sqlite')) || null;
    if (!autoFile) await page.waitForTimeout(500);
  }
  const stamped = existsSync(join(profile, 'desktop-settings.json')) ? JSON.parse(readFileSync(join(profile, 'desktop-settings.json'), 'utf8')) : {};
  check('U-14b', 'The scheduled automatic backup ran by itself and was recorded as successful', Boolean(autoFile) && Boolean(stamped.lastBackupAt) && !stamped.lastBackupError, autoFile || `no automatic backup file; folder: ${existsSync(backupDirPath) ? readdirSync(backupDirPath).join(',') : 'missing'}; settings: ${JSON.stringify(stamped)}`);

  await page.fill('#owner-name', 'Priya Sharma');
  await page.fill('#owner-email', EMAIL);
  await page.fill('#owner-password', 'short1');
  await page.fill('#owner-confirm', 'short1');
  await page.getByRole('button', { name: /Create account/ }).click();
  check('U-04', 'A weak password is refused with a clear message', await page.getByText(/at least 8 characters/).first().isVisible());
  await page.fill('#owner-password', PW);
  await page.fill('#owner-confirm', 'Different99x');
  await page.getByRole('button', { name: /Create account/ }).click();
  check('U-05', 'Mismatched passwords are refused', await page.getByText('The two passwords do not match.').isVisible());
  await page.fill('#owner-confirm', PW);
  await page.getByRole('button', { name: /Create account/ }).click();

  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  const key = (await page.getByTestId('recovery-key').innerText()).trim();
  check('U-06', 'The owner is shown a one-time recovery key', /^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/.test(key), key.replace(/./g, (c, i) => (i < 4 ? c : '*')));
  const cont = page.getByRole('button', { name: 'Continue' });
  check('U-07', 'Cannot continue until the key is confirmed saved', await cont.isDisabled());
  await page.check('#recovery-saved');
  await cont.click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  check('U-08', 'Owner lands on the dashboard after setup', /Dashboard/i.test(await bodyText(page)));
  await page.screenshot({ path: join(shots, 'dashboard.png') });

  // ------------------------------------------------------------------ settings: no server connection screen
  await page.getByRole('link', { name: 'Device Settings' }).click();
  await page.getByText('Backup & recovery').waitFor({ timeout: 10000 });
  const settings = await bodyText(page);
  check('U-09', 'Device Settings has no server address, port, health-check or "advanced connection" fields', !FORBIDDEN.test(settings) && (await page.locator('input[type=text],input:not([type])').count()) === 0, '');
  await page.getByText('Working normally').waitFor({ timeout: 15000 }).catch(() => undefined);
  check('U-10', 'Status is shown in plain words', /Working normally/.test(await bodyText(page)));
  await page.screenshot({ path: join(shots, 'settings.png') });

  await page.getByRole('button', { name: 'Back up now' }).click();
  await page.getByText('Backup made and checked.').waitFor({ timeout: 40000 });
  check('U-11', 'Owner can back up now; the backup is checked and listed', (await page.getByRole('button', { name: 'Restore', exact: true }).count()) >= 1);

  await page.getByRole('button', { name: /Create a new recovery key/ }).click();
  await page.fill('input[aria-label="Your password"]', 'wrong-password-1');
  await page.getByRole('button', { name: 'Create key' }).click();
  await page.getByText('That password is not correct.').waitFor({ timeout: 10000 }).catch(() => undefined);
  check('U-12', 'A new recovery key needs the owner password', await page.getByText('That password is not correct.').isVisible());
  await page.fill('input[aria-label="Your password"]', PW);
  await page.getByRole('button', { name: 'Create key' }).click();
  await page.getByText('Save your new recovery key').waitFor({ timeout: 10000 });
  const key2 = (await page.getByTestId('recovery-key').innerText()).trim();
  check('U-13', 'A replacement recovery key is issued and differs from the first', key2 !== key && /^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/.test(key2));
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Support section is owner-only and collapsed
  await page.getByText('Support information (administrator)').click();
  await page.getByText(/Services: responding/).waitFor({ timeout: 15000 });
  check('U-14', 'Administrator support information is available to the owner and reports healthy services', /database OK/.test(await bodyText(page)));

  // ------------------------------------------------------------------ sign out / in
  await page.getByRole('button', { name: /Logout|Sign out/i }).first().click().catch(async () => {
    await page.locator('header button').last().click();
  });
  await page.getByText('Sign In to Food Court').waitFor({ timeout: 10000 });
  await page.fill('input[type=email]', EMAIL.toLowerCase());
  await page.fill('input[type=password]', 'Wrong-pass-1');
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.getByText('Invalid email or password.').waitFor({ timeout: 10000 });
  check('U-15', 'Wrong password: clear message, nothing technical', !FORBIDDEN.test(await bodyText(page)));
  await page.fill('input[type=email]', EMAIL.toUpperCase());
  await page.fill('input[type=password]', PW);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  check('U-16', 'Correct password signs in even when the email is typed in other capitals', true);

  // ------------------------------------------------------------------ restart keeps data, stops server
  await app.close();
  await new Promise((r) => setTimeout(r, 1500));
  check('U-17', 'Closing the app stops its built-in server (nothing left running)', phpRunningFor() === 0, `php processes: ${phpRunningFor()}`);

  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => /dashboard|login/i.test(location.hash) && !/Welcome/.test(document.body.innerText), null, { timeout: 60000 });
  check('U-18', 'Reopening needs no setup and no commands; the data is still there', !/Welcome/.test(await bodyText(page)));

  // ------------------------------------------------------------------ forgotten password
  await page.evaluate(() => {
    localStorage.clear();
    location.hash = '#/login';
    location.reload();
  });
  await page.getByText('Forgot password?').click();
  await page.fill('input[aria-label="Owner email"]', EMAIL);
  await page.fill('input[aria-label="Recovery key"]', key); // the OLD key, replaced earlier
  await page.fill('input[aria-label="New password"]', 'N3wPassword77');
  await page.fill('input[aria-label="Confirm new password"]', 'N3wPassword77');
  await page.getByRole('button', { name: 'Restore access' }).click();
  await page.getByText('The recovery key is not valid.').waitFor({ timeout: 15000 });
  check('U-19', 'A replaced (old) recovery key no longer works', true);
  await page.fill('input[aria-label="Recovery key"]', key2.toLowerCase());
  await page.getByRole('button', { name: 'Restore access' }).click();
  await page.getByText('Access restored: save your NEW recovery key').waitFor({ timeout: 15000 });
  check('U-20', 'The current recovery key resets the owner password and issues a new key', true);
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', 'N3wPassword77');
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  check('U-21', 'Owner signs in with the recovered password', true);
  await app.close();
  app = null;

  // ------------------------------------------------------------------ failure screens (plain words, data untouched)
  const bad = mkdtempSync(join(tmpdir(), 'foodcourt-ui-bad-'));
  mkdirSync(join(bad, 'server'), { recursive: true });
  const junk = Buffer.from('this is not a database '.repeat(400));
  writeFileSync(join(bad, 'server', 'foodcourt.sqlite'), junk);
  const badApp = await electron.launch({ ...(EXE_ARG && !EXE_ARG.endsWith('.asar') ? { executablePath: EXE_ARG } : { args: [EXE_ARG || APP_DIR] }), env: { ...process.env, FOODCOURT_USER_DATA_DIR: bad, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' }, timeout: 60000 });
  try {
    const bp = await badApp.firstWindow();
    await bp.getByText('Service unavailable. Contact your administrator.').waitFor({ timeout: 60000 });
    const t = await bodyText(bp);
    await bp.screenshot({ path: join(shots, 'service-unavailable.png') });
    check('U-22', 'A damaged database shows "Service unavailable. Contact your administrator." with Try again / Restore / Copy support info', await bp.getByRole('button', { name: 'Try again' }).isVisible() && await bp.getByRole('button', { name: /Restore a backup/ }).isVisible() && await bp.getByRole('button', { name: /Copy support information/ }).isVisible());
    check('U-23', 'The failure text is plain language and says the data was not changed', /Your data has not been changed/.test(t) && !FORBIDDEN.test(t) && !/SQLSTATE|malformed|[A-Z]:[\\/]/i.test(t), t.slice(0, 90).replace(/\s+/g, ' '));
    check('U-24', 'The damaged database file was left exactly as it was', readFileSync(join(bad, 'server', 'foodcourt.sqlite')).equals(junk));
  } finally {
    await badApp.close();
    rmSync(bad, { recursive: true, force: true });
  }

  const away = mkdtempSync(join(tmpdir(), 'foodcourt-ui-away-'));
  const awayApp = await electron.launch({ ...(EXE_ARG && !EXE_ARG.endsWith('.asar') ? { executablePath: EXE_ARG } : { args: [EXE_ARG || APP_DIR] }), env: { ...process.env, FOODCOURT_USER_DATA_DIR: away, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: 'http://127.0.0.1:9/api' }, timeout: 60000 });
  try {
    const ap = await awayApp.firstWindow();
    await ap.getByText('Cannot reach the food court', { exact: true }).waitFor({ timeout: 30000 });
    const t = await bodyText(ap);
    check('U-25', 'A PC whose food court host is switched off is told so in plain words, with Try again', /switched on/.test(t) && await ap.getByRole('button', { name: 'Try again' }).isVisible() && !FORBIDDEN.test(t), t.slice(0, 90).replace(/\s+/g, ' '));
  } finally {
    await awayApp.close();
    rmSync(away, { recursive: true, force: true });
  }
} catch (err) {
  check('U-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n')[0]);
  try {
    if (page) await page.screenshot({ path: join(shots, 'failure.png') });
  } catch {}
} finally {
  try {
    if (app) await app.close();
  } catch {}
  const logFile = join(profile, 'logs', 'desktop.log');
  if (existsSync(logFile)) {
    const log = readFileSync(logFile, 'utf8');
    const leaked = /Str0ngPass99|N3wPassword77|Bearer |password"/i.test(log);
    console.log(log.split('\n').filter((l) => /ackup/.test(l)).join('\n'));
    check('U-LOG', 'The support log contains no passwords or tokens', !leaked, `${log.split('\n').filter(Boolean).length} lines`);
  }
  writeFileSync(join(shots, 'ui-first-run-results.json'), JSON.stringify(results, null, 2));
  rmSync(profile, { recursive: true, force: true });
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
