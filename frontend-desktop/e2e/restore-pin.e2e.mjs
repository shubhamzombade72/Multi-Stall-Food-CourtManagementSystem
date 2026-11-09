/**
 * Restoring a backup keeps the PIN, driven through real Electron, real Windows DPAPI and the built-in server, on a
 * throw-away profile. The session in use is deliberately NEWER than the backup, so its token is not in the restored data.
 *
 *   cd frontend-desktop && pnpm build
 *   node e2e/restore-pin.e2e.mjs
 */
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-restore-pin-'));
const EMAIL = 'restore.owner@example.com';
const PASSWORD = 'Str0ngPass99';
const PIN = '482916';
const PIN2 = '305871';

let failures = 0;
const check = (id, desc, pass, ev = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const app = await electron.launch({
  args: [APP_DIR],
  env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '', FOODCOURT_PIN_LOCK: '' },
  timeout: 60000,
});

try {
  const page = await app.firstWindow();
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const createPin = async (pin) => {
    await page.locator('#pin-new').waitFor({ timeout: 30000 });
    await page.fill('#pin-new', pin);
    await page.fill('#pin-confirm', pin);
    await page.getByRole('button', { name: /Save PIN/ }).click();
  };
  const onDashboard = () => page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 30000 });

  // A new owner with a PIN
  await page.locator('#owner-name').waitFor({ timeout: 60000 });
  await page.fill('#owner-name', 'Restore Owner');
  await page.fill('#owner-email', EMAIL);
  await page.fill('#owner-password', PASSWORD);
  await page.fill('#owner-confirm', PASSWORD);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await createPin(PIN);
  await onDashboard();

  // The backup, taken while the first session is in use
  const made = await page.evaluate(() => window.desktop.backupNow());
  check('R-00', 'A backup was made', made.ok, made.error || '');

  // Forgot PIN rotates the session and the PIN, so nothing about the current sign-in is in that backup
  await page.getByRole('button', { name: /^Lock/ }).click();
  await page.getByTestId('pin-key-0').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Forgot PIN?' }).click();
  await page.fill('input[type=password]', PASSWORD);
  await page.getByRole('button', { name: /Sign In|Continue|Verify/ }).first().click();
  await createPin(PIN2);
  await page.locator('#pin-new').waitFor({ state: 'detached', timeout: 30000 });

  // Answer the "Replace the current data?" question the way the owner would
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  const status = await page.evaluate(() => window.desktop.getBackupStatus());
  const name = status.backups.find((b) => b.kind === 'manual')?.name;
  check('R-01', 'The backup is listed', Boolean(name), name);

  const restored = await page.evaluate((n) => window.desktop.restoreBackup(n), name);
  check('R-02', 'The restore succeeded', restored.ok, restored.error || '');
  const dir = join(profile, 'server', 'backups');
  check('R-03', 'The data really was swapped (a before-restore copy exists)', readdirSync(dir).some((n) => n.startsWith('foodcourt-before-restore-')));
  check('R-04', 'The saved sign-in file is still there', existsSync(join(profile, 'auth-vault.json')));

  await page.evaluate(() => {
    location.hash = '#/login';
    location.reload();
  });
  await page.getByTestId('pin-key-0').waitFor({ timeout: 30000 });
  const screen = await bodyText();
  check('R-05', 'After the restore the PIN screen opens, with no email or password', screen.includes(EMAIL) && (await page.locator('input[type=password],input[type=email]').count()) === 0);

  for (const d of PIN2) await page.getByTestId(`pin-key-${d}`).click();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pin-key-0"]'), null, { timeout: 30000 });
  await page.waitForFunction(() => !/login/i.test(location.hash), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const after = await bodyText();
  check('R-06', 'The current PIN opens the app; the server accepts the carried session', /Dashboard/.test(after) && (await page.locator('input[type=password]').count()) === 0, after.slice(0, 100).replace(/\s+/g, ' '));
} catch (err) {
  failures += 1;
  console.log(`FAIL  crashed: ${err.message}`);
} finally {
  await app.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 800));
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
