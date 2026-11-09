/**
 * What the Software updates screen tells the owner before and after the automatic download, in the real renderer.
 * The agent's state is supplied by the test, because the question is only what the screen says about each state.
 * Temporary profile and LOCALAPPDATA, so a real install on this PC and any update waiting on it are not touched.
 *
 *   cd frontend-desktop && pnpm build
 *   node e2e/updates-screen.e2e.mjs
 *   PACKAGED_ASAR=<win-unpacked>/resources/app.asar FOODCOURT_SERVER_DIR=<win-unpacked>/resources/server node e2e/updates-screen.e2e.mjs
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'foodcourt-updates-screen-'));
const shotDir = join(APP_DIR, '..', 'qa', 'desktop', 'results', 'update-required');
mkdirSync(shotDir, { recursive: true });
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 240)}]` : ''}`);
};

const baseState = {
  enabled: true,
  blocked: null,
  hasKeys: true,
  policy: { mode: 'idle', window: { start: '02:00', end: '05:00' } },
  policyLocked: true,
  pending: null,
  waitingFor: [],
  paused: false,
  enrolled: true,
  channel: null,
  currentVersion: '1.3.3',
  mode: 'embedded',
  phase: 'idle',
  progress: null,
  error: null,
  message: null,
  checkedAt: new Date().toISOString(),
  serverBlocked: null,
  update: { version: '1.3.4', channel: 'stable', required: false, releaseDate: '2026-11-07T07:23:00Z', packageType: 'full', packageSize: 17686381, notes: { features: ['Fixed a link'] } },
  snoozed: false,
  lastResult: null,
  recoveryPoints: 1,
};
const notDownloaded = baseState;
const downloading = { ...baseState, phase: 'downloading', progress: { received: 8000000, total: 17686381 } };
const downloaded = { ...baseState, pending: { version: '1.3.4', source: 'online', readyAt: new Date().toISOString(), approved: false, installAt: new Date().toISOString() } };

let app;
try {
  const env = { ...process.env, LOCALAPPDATA: join(root, 'local'), FOODCOURT_USER_DATA_DIR: join(root, 'profile'), FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '', FOODCOURT_UPDATE_FIRST_CHECK_MS: '86400000' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: [process.env.PACKAGED_ASAR || APP_DIR], env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Updates Owner');
  await page.fill('#owner-email', 'updates.owner@example.com');
  await page.fill('#owner-password', 'Str0ngPass99');
  await page.fill('#owner-confirm', 'Str0ngPass99');
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('update:get-state');
    ipcMain.handle('update:get-state', () => globalThis.__updateScreenState);
  });
  const show = async (state) => {
    await app.evaluate((_, s) => { globalThis.__updateScreenState = s; }, state);
    await page.waitForTimeout(1500); // the screen refreshes each second
  };
  const text = () => page.getByTestId('updates-page').innerText();

  await show(notDownloaded);
  await page.evaluate(() => { location.hash = '#/updates'; });
  await page.getByTestId('updates-page').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  let body = await text();
  check('A-01', 'Before the download it says the version is available, with its download size', /Version\s*1\.3\.4\s*is available/.test(body) && /Download size/.test(body), body.replace(/\s+/g, ' ').slice(0, 200));
  check('A-02', 'Before the download it offers Update Now', await page.getByTestId('update-now').isVisible() && /Update Now/.test(await page.getByTestId('update-now').innerText()));

  await show(downloading);
  body = await text();
  check('D-01', 'While downloading it shows progress', /Downloading the update/.test(body) && await page.getByTestId('update-progress').isVisible());

  await show(downloaded);
  body = await text();
  check('R-01', 'After the download it says downloaded and checked', /is downloaded and checked/.test(body));
  check('R-02', 'After the download it no longer says the version is available', !/is available/.test(body), body.replace(/\s+/g, ' ').slice(0, 320));
  check('R-03', 'After the download it no longer speaks of a download size', !/Download size/.test(body));
  check('R-04', 'It says the update will install by itself and nothing is needed', /install by itself as soon as this computer is not in use/.test(body));
  const buttons = await page.getByRole('button', { name: /Update Now|Install now/ }).allInnerTexts();
  check('R-05', 'There is exactly one install button, and it says Install now', buttons.length === 1 && /Install now/.test(buttons[0]), JSON.stringify(buttons));
  await page.getByRole('button', { name: /Update Now|Install now/ }).first().click();
  const confirm = page.getByRole('button', { name: 'Close and update' });
  check('R-06', 'That button still asks for confirmation first', await confirm.first().waitFor({ timeout: 5000 }).then(() => true, () => false) && (await confirm.count()) === 1, await confirm.count());
  await page.getByRole('button', { name: 'Not now' }).first().click();

  // ---------------- the mandatory screen, state by state
  const token = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  const apiBase = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  const post = async (path, body) => (await (await fetch(`${apiBase}${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).json()).data;
  const stall = await post('/stalls', { name: 'Gate Stall', code: 'GATE' });
  const cat = await post('/menu-categories', { stall_id: stall.id, name: 'Gate Menu' });
  await post('/menu', { stall_id: stall.id, category_id: cat.id, name: 'Gate Dosa', price: 90 });
  await app.evaluate(({ ipcMain }) => {
    globalThis.__installResult = { ok: false, code: 'download', error: 'The update could not be downloaded because the internet connection failed. Your software was not changed. Check the connection and press Retry.' };
    ipcMain.removeHandler('update:install-required');
    ipcMain.handle('update:install-required', () => globalThis.__installResult);
  });
  const required = { ...baseState, update: { ...baseState.update, version: '1.4.0', required: true }, required: { version: '1.4.0', notes: { security: ['Important fix'] }, downloaded: false, failedBefore: false } };
  const isInert = () => page.evaluate(() => Boolean(document.querySelector('aside nav')?.closest('[inert]')));

  // A cart is open: a banner, not the screen, so the sale is not lost
  await show(baseState);
  await page.evaluate(() => { location.hash = '#/pos'; });
  await page.locator('[data-menu-item="Gate Dosa"]').first().click({ timeout: 20000 });
  await show(required);
  check('G-01', 'With a cart open, a mandatory update shows a fixed banner, not the screen, and the sale can go on', await page.getByTestId('update-required-banner').isVisible() && (await page.getByTestId('update-required-dialog').count()) === 0 && !(await isInert()), await page.getByTestId('update-required-banner').innerText().catch(() => ''));
  await page.screenshot({ path: join(shotDir, 'required-banner-open-cart.png') });
  await page.evaluate(() => { location.hash = '#/dashboard'; }); // leaving the POS clears its cart
  const screenAfterCart = await page.getByTestId('update-required-dialog').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('G-02', 'Once the cart is gone, the screen takes over and the app behind it is inert', screenAfterCart && (await isInert()));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="update-required-overlay"]')).backgroundColor);
  check('G-03', 'The backdrop really dims the application behind it', /rgba\(0, 0, 0, 0\.6\)/.test(bg), bg);
  await page.screenshot({ path: join(shotDir, 'required-screen.png') });

  await page.getByTestId('update-required-now').click();
  const err = await page.getByTestId('update-required-error').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('G-04', 'A failed attempt shows its reason and a Retry button', err && /Retry/.test(await page.getByTestId('update-required-now').innerText()));
  await app.evaluate(() => { globalThis.__installResult = new Promise(() => undefined); }); // the next attempt keeps running
  await page.getByTestId('update-required-now').click();
  await show({ ...required, phase: 'downloading', progress: { received: 7000000, total: 17500000 } });
  check('G-05', 'While the retry downloads, the old error is gone and the percentage shows', (await page.getByTestId('update-required-error').count()) === 0 && (await page.getByTestId('update-required-percent').innerText()) === '40%' && (await page.getByTestId('update-required-now').count()) === 0);
  await page.screenshot({ path: join(shotDir, 'required-downloading.png') });

  // A release that failed and was rolled back may be retried, but must not lock the PC in a loop
  await app.evaluate(() => { globalThis.__installResult = { ok: false, code: 'not_required' }; });
  await page.reload();
  await page.locator('aside nav').waitFor({ timeout: 30000 }).catch(() => undefined);
  await show({ ...required, required: { ...required.required, failedBefore: true }, lastResult: { outcome: 'recovered', version: '1.4.0', at: new Date().toISOString() } });
  const failedScreen = await page.getByTestId('update-required-dialog').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('G-06', 'After a failed and rolled-back install the screen says so and offers Retry', failedScreen && /did not finish/.test(await page.getByTestId('update-required-dialog').innerText()) && /Retry/.test(await page.getByTestId('update-required-now').innerText()));
  await page.screenshot({ path: join(shotDir, 'required-failed-before.png') });
  await page.getByTestId('update-required-continue').click();
  await page.waitForTimeout(1200);
  check('G-07', '...and lets the shop carry on with the restored version', (await page.getByTestId('update-required-dialog').count()) === 0 && !(await isInert()));
} catch (err) {
  check('ABORT', 'The script stopped early', false, err?.stack || err);
} finally {
  if (app) await app.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
