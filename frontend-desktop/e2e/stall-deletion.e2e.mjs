/**
 * Stall deletion lifecycle through the real Electron runtime (built-in SQLite server, brand-new profile). Test data only.
 *
 *   cd frontend-desktop && node scripts/prepare-embedded-server.mjs && npm run build
 *   node e2e/stall-deletion.e2e.mjs                      # unpackaged
 *   PACKAGED_EXE=<...>\win-unpacked\MangalMurti POS.exe node e2e/stall-deletion.e2e.mjs   # the packaged app
 *
 *  1  Every stall card has a Delete button (owner); it opens the shared dialog for that one stall
 *  2  A stall with no history: dialog offers permanent deletion; Cancel deletes nothing
 *  3  Confirm: stall gone from the API and the directory refreshed
 *  4  A stall with order history: dialog explains why it cannot be deleted and offers only Deactivate
 *  5  Deactivate from inside the dialog: stall inactive, history intact, no new orders for it
 *  6  Multi-select: eligible and blocked stalls are grouped, deletion only sends the eligible one, every stall gets an outcome line
 *  7  "Deactivate all blocked" deactivates the rest; history intact
 *  8  A cashier is refused by the preview endpoint (403)
 */
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const PACKAGED_EXE = process.env.PACKAGED_EXE || '';
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 220)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-stalldel-'));
const localAppData = mkdtempSync(join(tmpdir(), 'foodcourt-stalldel-local-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'stall-deletion', PACKAGED_EXE ? 'packaged' : 'unpackaged');
mkdirSync(shots, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';

let app;
let page;
let API = '';
const pageErrors = [];

const api = async (token, method, path, body, raw) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (raw) return { status: res.status, json };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const goto = async (hash) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForTimeout(500);
};
const card = (name) => page.getByTestId('stall-card').filter({ hasText: name });

try {
  app = await electron.launch({
    ...(PACKAGED_EXE ? { executablePath: PACKAGED_EXE, args: [] } : { args: [APP_DIR] }),
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, LOCALAPPDATA: localAppData, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' },
    timeout: 90000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 120000 });
  await page.fill('#owner-name', 'Stall Owner');
  await page.fill('#owner-email', 'stall.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 30000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 30000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('S-00', `Fresh profile: built-in (SQLite) server started and owner created${PACKAGED_EXE ? ' (PACKAGED app)' : ''}`, Boolean(ownerToken), API);

  // ---------------------------------------------------------------- test data
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const mkStall = async (name, code) => {
    const s = (await api(ownerToken, 'POST', '/stalls', { name, code: `${code}${tag}` })).data;
    const c = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: s.id, name: 'Mains' })).data;
    const d = (await api(ownerToken, 'POST', '/menu', { stall_id: s.id, category_id: c.id, name: `${name} dish`, price: 120 })).data;
    return { ...s, dish: d };
  };
  const cleanOne = await mkStall('SD Clean One', 'C1');
  const cleanTwo = await mkStall('SD Clean Two', 'C2');
  const histCafe = await mkStall('SD History Cafe', 'H1');
  const histTwo = await mkStall('SD History Two', 'H2');
  const staffStall = await mkStall('SD Staff Stall', 'ST');
  await api(ownerToken, 'POST', '/staff', { name: 'Stall Mgr', email: `mgr.${tag}@example.com`, password: STAFF_PW, role: 'stall_manager', stall_id: staffStall.id });
  await api(ownerToken, 'POST', '/staff', { name: 'SD Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;
  const placeOrder = async (dishId) => {
    const o = (await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: dishId, quantity: 1 }] })).data;
    return (o.order ?? o).id;
  };
  const orderCafe = await placeOrder(histCafe.dish.id);
  const orderTwo = await placeOrder(histTwo.dish.id);
  const stalls = async () => (await api(ownerToken, 'GET', '/stalls?include_inactive=1')).data;
  const find = async (id) => (await stalls()).find((s) => s.id === id);
  const orderLines = async (orderId) => (await api(ownerToken, 'GET', `/orders/${orderId}`)).data.items?.length ?? 0;
  check('S-01', 'Test data created through the API: 5 stalls, 2 with order history, 1 with a staff account', (await stalls()).length === 5, `stalls=${(await stalls()).length}`);

  await goto('#/stalls');
  await page.getByTestId('stall-card').first().waitFor({ timeout: 30000 });

  // ================================================================== Scenario A: no history -> permanent deletion
  const deleteButtons = await page.getByTestId('stall-delete').count();
  check('S-02', 'Every stall card has a Delete button for the owner', deleteButtons === 5, `buttons=${deleteButtons}`);

  await card('SD Clean One').getByTestId('stall-delete').click();
  await page.getByTestId('bulk-dialog').waitFor();
  await page.getByTestId('stall-deletable').waitFor({ timeout: 20000 });
  const deletableText = await page.getByTestId('stall-deletable').innerText();
  const confirmLabel = await page.getByTestId('bulk-confirm').innerText();
  const hasBlocked = await page.getByTestId('stall-blocked').count();
  await page.screenshot({ path: join(shots, 'A1-deletable-confirm.png') });
  check('S-03', 'Stall without history: dialog lists it as deletable, offers "Delete 1 stall permanently" and no blocked group', /SD Clean One/.test(deletableText) && /permanently/i.test(confirmLabel) && hasBlocked === 0, `${confirmLabel} | blocked=${hasBlocked}`);
  await page.getByTestId('bulk-cancel').click();
  check('S-04', 'Cancel deletes nothing', Boolean(await find(cleanOne.id)));

  await card('SD Clean One').getByTestId('stall-delete').click();
  await page.getByTestId('bulk-confirm').click();
  await page.getByTestId('bulk-summary').waitFor({ timeout: 30000 });
  const sumDeleted = await page.getByTestId('bulk-summary-deleted').innerText();
  await page.screenshot({ path: join(shots, 'A2-deleted-summary.png') });
  await page.getByTestId('bulk-done').click();
  await page.waitForTimeout(600);
  check('S-05', 'Confirm: stall deleted for good (API) and the directory refreshed without it', !(await find(cleanOne.id)) && (await card('SD Clean One').count()) === 0 && /1$/.test(sumDeleted), `${sumDeleted} cards=${await card('SD Clean One').count()}`);

  // ================================================================== Scenario B: history -> explain + Deactivate in the dialog
  const linesBefore = await orderLines(orderCafe);
  await card('SD History Cafe').getByTestId('stall-delete').click();
  await page.getByTestId('bulk-dialog').waitFor();
  await page.getByTestId('stall-blocked').waitFor({ timeout: 20000 });
  const blockedText = await page.getByTestId('stall-blocked').innerText();
  const deleteOffered = await page.getByTestId('bulk-confirm').count();
  const deactBtn = await page.getByTestId('stall-deactivate').count();
  await page.screenshot({ path: join(shots, 'B1-blocked-explanation.png') });
  check('S-06', 'Stall with history: dialog explains the restriction (order line + kitchen ticket + history) and offers Deactivate, not permanent deletion',
    /order line/.test(blockedText) && /kitchen ticket/.test(blockedText) && /history/i.test(blockedText) && /Deactivate/.test(blockedText) && deleteOffered === 0 && deactBtn === 1, blockedText.replace(/\s+/g, ' ').slice(0, 200));

  await page.getByTestId('stall-deactivate').click();
  await page.getByTestId('stall-deactivated').waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shots, 'B2-deactivated-in-dialog.png') });
  await page.getByTestId('bulk-done').click();
  await page.waitForTimeout(600);
  const cafe = await find(histCafe.id);
  const cardChip = await card('SD History Cafe').innerText();
  check('S-07', 'Deactivate from the dialog: stall inactive (API + card), order and its line untouched', cafe && !cafe.is_active && /Inactive/.test(cardChip) && (await orderLines(orderCafe)) === linesBefore, `active=${cafe?.is_active} lines=${await orderLines(orderCafe)}`);
  const refused = await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: histCafe.dish.id, quantity: 1 }] }, true);
  check('S-08', 'No new orders for the deactivated stall (422)', refused.status === 422, `${refused.status} ${JSON.stringify(refused.json).slice(0, 100)}`);

  // ================================================================== multi-select
  await page.getByLabel('Select SD Clean Two').check();
  await page.getByLabel('Select SD History Two').check();
  await page.getByLabel('Select SD Staff Stall').check();
  await page.getByTestId('bulk-delete-open').click();
  await page.getByTestId('stall-deletable').waitFor({ timeout: 20000 });
  await page.getByTestId('stall-blocked').waitFor();
  const dText = await page.getByTestId('stall-deletable').innerText();
  const bText = await page.getByTestId('stall-blocked').innerText();
  const allBtn = await page.getByTestId('stall-deactivate-all').count();
  await page.screenshot({ path: join(shots, 'C1-bulk-review.png') });
  check('S-09', 'Bulk: 1 eligible and 2 blocked stalls are grouped; staff-only stall gets the reassign/remove advice; "Deactivate all blocked" offered',
    /SD Clean Two/.test(dText) && !/SD History Two/.test(dText) && /SD History Two/.test(bText) && /SD Staff Stall/.test(bText) && /reassign or remove/i.test(bText) && allBtn === 1, `${allBtn} | ${bText.replace(/\s+/g, ' ').slice(0, 160)}`);

  await page.getByTestId('bulk-confirm').click();
  await page.getByTestId('bulk-summary').waitFor({ timeout: 30000 });
  const outcomes = await page.getByTestId('bulk-outcomes').innerText();
  const keptLine = await page.getByTestId('bulk-summary-kept').innerText();
  await page.screenshot({ path: join(shots, 'C2-bulk-outcomes.png') });
  await page.getByTestId('bulk-done').click();
  await page.waitForTimeout(600);
  check('S-10', 'Bulk delete removes only the eligible stall, counts the 2 kept stalls and reports an outcome line for every selected stall',
    /Kept, not deleted: 2$/.test(keptLine) && !(await find(cleanTwo.id)) && Boolean(await find(histTwo.id)) && Boolean(await find(staffStall.id)) && /SD Clean Two.*permanently deleted/s.test(outcomes) && /SD History Two.*not deleted/s.test(outcomes) && /SD Staff Stall.*not deleted/s.test(outcomes), outcomes.replace(/\s+/g, ' ').slice(0, 220));

  await page.getByLabel('Select SD History Two').check();
  await page.getByLabel('Select SD Staff Stall').check();
  await page.getByTestId('bulk-delete-open').click();
  await page.getByTestId('stall-deactivate-all').waitFor({ timeout: 20000 });
  check('S-11', 'Reopened with only blocked stalls: no permanent-delete button, Deactivate all offered', (await page.getByTestId('bulk-confirm').count()) === 0);
  await page.getByTestId('stall-deactivate-all').click();
  await page.getByTestId('stall-deactivated').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shots, 'C3-deactivate-all.png') });
  await page.getByTestId('bulk-done').click();
  await page.waitForTimeout(600);
  const two = await find(histTwo.id);
  const stf = await find(staffStall.id);
  check('S-12', 'Deactivate all blocked: both inactive, history and staff untouched', two && !two.is_active && stf && !stf.is_active && (await orderLines(orderTwo)) === 1, `two=${two?.is_active} staff=${stf?.is_active}`);

  // ================================================================== authorisation + noise
  const pv = await api(cashierToken, 'POST', '/stalls/deletion-preview', { ids: [histTwo.id] }, true);
  const pg = await api(null, 'POST', '/stalls/deletion-preview', { ids: [histTwo.id] }, true);
  check('S-13', 'The preview endpoint refuses a cashier (403) and a guest (401)', pv.status === 403 && pg.status === 401, `${pv.status}/${pg.status}`);

  const real = pageErrors.filter((e) => !/Failed to load resource|ERR_|net::|frame-ancestors/.test(e));
  check('S-14', 'No unexpected renderer errors during the whole run', real.length === 0, real.slice(0, 3).join(' | '));
} catch (err) {
  check('S-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 3).join(' '));
  try {
    if (page) await page.screenshot({ path: join(shots, 'failure.png') });
    if (page) console.log(`url=${page.url()} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\s+/g, ' ')}`);
  } catch {}
  if (pageErrors.length) console.log(`Renderer errors:\n${pageErrors.slice(-10).join('\n')}`);
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(HERE, '..', '..', 'qa', 'desktop', 'results', 'stall-deletion', `results-${PACKAGED_EXE ? 'packaged' : 'unpackaged'}.json`), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  for (const d of [profile, localAppData]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
