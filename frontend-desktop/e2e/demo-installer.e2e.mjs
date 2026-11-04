/**
 * Verifies the DEMO-DATA build: the packaged app, started on a brand-new profile, installs its dummy-data database,
 * skips the Welcome screen, signs in with the demo owner and shows the seeded payout scenario. Then it makes one real
 * payout and restarts to prove the demo database is installed only once (the owner's work is never replaced).
 *
 *   node e2e/demo-installer.e2e.mjs [path-to-packaged-exe]
 *     default: installers/<version>/win-unpacked/Multi-Stall Food Court Management System.exe
 *     fallback (Smart App Control can block a freshly built unsigned exe): this folder's Electron + the packaged
 *     resources/app.asar and resources/server, which is the same code and the same demo database.
 */
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const UNPACKED = join(ROOT, 'installers', version, 'win-unpacked');
const EXE = process.argv[2] || join(UNPACKED, 'Multi-Stall Food Court Management System.exe');
const OUT = join(ROOT, '..', 'qa', 'desktop', 'results', 'demo');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-demo-'));
let app;
let page;
let API = '';
let mode = 'packaged exe';
const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const env = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' };
const launch = async () => {
  try {
    app = await electron.launch({ executablePath: EXE, env, timeout: 45000 });
    mode = 'packaged exe';
  } catch (err) {
    console.log(`NOTE  packaged exe could not be started here (${String(err.message).split('\n')[0]}); using Electron + the packaged app.asar and server`);
    mode = 'Electron + packaged app.asar/server';
    app = await electron.launch({
      args: [join(UNPACKED, 'resources', 'app.asar')],
      env: { ...env, FOODCOURT_SERVER_DIR: join(UNPACKED, 'resources', 'server') },
      timeout: 60000,
    });
  }
  page = await app.firstWindow();
  page.on('dialog', (d) => d.accept());
};
const login = async () => {
  // After a restart the owner is usually still signed in (session kept on this PC); otherwise the login form is shown
  await page.waitForFunction(() => document.querySelector('input[type=email]') || /dashboard|settlements/i.test(location.hash), null, { timeout: 90000 });
  if (await page.locator('input[type=email]').count()) {
    await page.fill('input[type=email]', 'owner@foodcourt.com');
    await page.fill('input[type=password]', 'password123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
    await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 30000 });
  }
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  return page.evaluate(() => localStorage.getItem('fc_auth_token'));
};
const api = async (token, path) => (await (await fetch(`${API}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })).json());
const row = (stall) => page.locator(`[data-testid="settlement-row"][data-stall="${stall}"]`);
const figures = async (stall) => ({
  paid: (await row(stall).getByTestId('row-paid').innerText()).trim(),
  remaining: (await row(stall).getByTestId('row-remaining').innerText()).trim(),
  status: await row(stall).getByTestId('payout-status').getAttribute('data-status'),
});

try {
  if (!existsSync(UNPACKED) && !process.argv[2]) throw new Error(`Build first: ${UNPACKED} not found`);
  await launch();
  const demoDb = join(UNPACKED, 'resources', 'server', 'demo', 'foodcourt-demo.sqlite');
  check('D-00', `Packaged build ships the dummy-data database (${mode})`, existsSync(demoDb), demoDb);

  // First start: no Welcome / owner creation, straight to Login
  await page.waitForSelector('input[type=email], #owner-name', { timeout: 90000 });
  const welcome = (await page.locator('#owner-name').count()) > 0;
  check('D-01', 'First start on a new profile goes straight to Login: the demo database (with its owner) was installed, no Welcome / owner setup', !welcome);
  await page.screenshot({ path: join(OUT, '01-login.png') });
  const token = await login();
  check('D-02', 'Signs in with the demo owner account (owner@foodcourt.com)', Boolean(token));

  const summary = (await api(token, '/settlements/daily-summary')).data;
  const today = summary.date;
  await page.locator('a[href="#/settlements"]').first().click();
  await page.getByTestId('settlement-row').first().waitFor({ timeout: 20000 });
  const pizza = await figures('Pizza Corner');
  const misal = await figures('Misal House');
  const biryani = await figures('Biryani Point');
  check('D-03', `Today (${today}) is closed with the example scenario: Pizza Corner PAID ₹5,000; Misal House PARTIALLY PAID ₹3,000 of ₹8,000; Biryani Point PENDING ₹6,000`,
    pizza.status === 'paid' && pizza.paid === money(5000) && misal.status === 'partially_paid' && misal.paid === money(3000) && misal.remaining === money(5000) && biryani.status === 'pending' && biryani.remaining === money(6000),
    JSON.stringify({ pizza, misal, biryani }));
  await page.screenshot({ path: join(OUT, '02-demo-today-scenario.png') });

  // Payout history: paid, partial, multi-transaction, reversal, failed attempt, consolidated
  const hist = (await api(token, '/settlements/payouts?per_page=200')).data.data;
  const has = (f) => hist.some(f);
  check('D-04', 'Payout history holds the demo ledger: multi-transaction stall, UPI + bank references, a reversed payout with its reversal entry, a failed attempt and consolidated owner payouts',
    hist.length >= 18 && has((p) => p.entry_type === 'reversal') && has((p) => p.status === 'reversed') && has((p) => p.status === 'failed') && has((p) => p.consolidated) && has((p) => p.payment_method === 'upi' && p.transaction_reference) && has((p) => p.payment_method === 'bank_transfer' && p.transaction_reference),
    `${hist.length} ledger rows`);
  await page.getByTestId('tab-history').click();
  await page.getByTestId('history-row').first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(OUT, '03-demo-payout-history.png') });

  await page.getByTestId('tab-owners').click();
  await page.getByTestId('owner-card').first().waitFor({ timeout: 15000 });
  const anand = page.getByTestId('owner-card').filter({ hasText: 'Anand Kulkarni' });
  const anandText = (await anand.innerText()).replace(/\s+/g, ' ');
  check('D-05', 'Owner-wise view: Anand Kulkarni holds 5 stalls with consolidated payout allocations', /5 stalls/.test(anandText) && /Dosa Dhaba/.test(anandText) && /Sweet Tooth/.test(anandText) && /Bank Transfer/.test(anandText), anandText.slice(0, 160));
  await page.screenshot({ path: join(OUT, '04-demo-owner-wise.png') });

  const recon = (await api(token, '/settlements/reconciliation')).data;
  check('D-06', 'Reconciliation on the demo data: payable = paid + outstanding, 0 discrepancies', recon.ok === true && recon.discrepancies.length === 0, JSON.stringify(recon.totals));

  // An unclosed demo day, to try day closing live
  const open = new Date(`${today}T00:00:00Z`);
  open.setUTCDate(open.getUTCDate() - 3);
  const openDate = open.toISOString().slice(0, 10);
  await page.getByTestId('tab-closing').click();
  await page.getByLabel('Business date').fill(openDate);
  await page.getByTestId('close-day').waitFor({ timeout: 15000 });
  check('D-07', `${openDate} has demo sales but is NOT closed: the "Execute End-of-Day Closing" button is offered so closing can be tried live`, (await page.getByText('Not closed yet').count()) > 0);
  await page.screenshot({ path: join(OUT, '05-demo-open-day.png') });

  // Real work in the demo, then a restart: the demo database must not be installed again
  await page.getByLabel('Business date').fill(today);
  await row('Biryani Point').getByTestId('record-payout').click();
  const dlg = page.getByRole('dialog').last();
  await dlg.getByLabel('Payout amount').fill('1500');
  await dlg.getByLabel('Payment method').selectOption('upi');
  await dlg.getByLabel('Transaction reference').fill('UPI-DEMO-TRY-001');
  await dlg.getByRole('button', { name: 'Confirm payout was made' }).click();
  await page.getByTestId('payout-receipt').waitFor({ timeout: 15000 });
  const before = (await api(token, '/settlements/payouts?per_page=200')).data.data.length;
  await app.close();

  await launch();
  const token2 = await login();
  const after = (await api(token2, '/settlements/payouts?per_page=200')).data.data;
  const biryaniAfter = (await api(token2, '/settlements/daily-summary')).data.closing.settlements.find((s) => s.stall.name === 'Biryani Point');
  check('D-08', 'After a restart the payout made in the demo is still there (the demo database is installed once, never over the owner\'s data)', after.length === before && after.length >= 19 && biryaniAfter.paid_amount === '1500.00' && biryaniAfter.payout_status === 'partially_paid', `${before} -> ${after.length} rows, Biryani paid ${biryaniAfter.paid_amount}`);
  await page.locator('a[href="#/settlements"]').first().click();
  await page.getByTestId('settlement-row').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(OUT, '06-demo-after-restart.png') });
} catch (err) {
  check('D-ERR', 'Run completed without an exception', false, err?.stack || err);
  try {
    await page?.screenshot({ path: join(OUT, 'zz-failure.png') });
  } catch {
    /* gone */
  }
} finally {
  const failed = results.filter((r) => r.result === 'FAIL').length;
  writeFileSync(join(OUT, '..', 'demo-installer-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), mode, exe: EXE, total: results.length, passed: results.length - failed, failed, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed (${mode})`);
  await app?.close().catch(() => undefined);
  process.exit(failed ? 1 : 0);
}
