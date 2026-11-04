/**
 * Sound + thermal printing, driven through the real Electron runtime (built-in server, brand-new profile).
 * "Printers" here are local TCP listeners that record the bytes they receive: this proves what the app SENDS,
 * not that any physical printer renders it. Test data only.
 *
 *   cd frontend-desktop && pnpm build        (prepare:server already done for the embedded server)
 *   node e2e/sound-printer.e2e.mjs
 *
 *  S1  Production build ships the sound files and the renderer can load every one (file:// origin, CSP media-src)
 *  S2  Sounds start without a user gesture (Electron autoplay policy) and honour the volume setting
 *  S3  A new Kitchen ticket sounds once and does not repeat on later polls; opening the board does not replay old tickets
 *  S4  Disabled sound plays nothing
 *  P1  Printer settings: receipt (80 mm) and kitchen (58 mm) on network listeners; test print reaches the listener
 *  P2  Receipt for a real order: business name, items, total; 80 mm width; a second click does not print a second slip
 *  P3  Stall-wise KOTs: one slip per stall, only that stall's items
 *  P4  Auto-print: a ticket arriving on the Kitchen board prints once, never again on later polls
 *  P5  Printer unreachable: job fails (visible banner + history), nothing marked sent; retry after recovery prints once
 *  P6  Restart: history is on disk and reloaded; duplicate protection survives
 */
import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 220)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-sp-'));
const outDir = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'sound-printer');
mkdirSync(outDir, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fake network printer: records every connection's bytes. */
const makePrinter = () =>
  new Promise((resolve) => {
    const jobs = [];
    const sockets = new Set();
    let server;
    const start = (port = 0) =>
      new Promise((ok) => {
        server = createServer((sock) => {
          sockets.add(sock);
          const chunks = [];
          sock.on('data', (d) => chunks.push(d));
          sock.on('error', () => undefined);
          sock.on('close', () => {
            sockets.delete(sock);
            const buf = Buffer.concat(chunks);
            if (buf.length) jobs.push(buf);
          });
        });
        server.listen(port, '127.0.0.1', () => ok(server.address().port));
      });
    start().then((port) => resolve({ port, jobs, text: (i) => jobs[i]?.toString('latin1') ?? '', stop: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(r); }), restart: () => start(port) }));
  });

let app;
let page;
let API = '';
const pageErrors = [];
const api = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};
const goto = async (hash) => {
  await page.evaluate((h) => void (location.hash = h), hash);
  await page.waitForTimeout(500);
};
const jobs = () => page.evaluate(() => window.desktop.listPrintJobs(100));
const waitFor = async (fn, ms = 20000, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
};

const launch = async () => {
  // PACKAGED_EXE=<path to win-unpacked\Multi-Stall Food Court Management System.exe> runs the installed build instead of the sources
  const launchOptions = process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [APP_DIR] };
  app = await electron.launch({ ...launchOptions, env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' }, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
};

const receiptP = await makePrinter();
const kotP = await makePrinter();

try {
  await launch();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Print Owner');
  await page.fill('#owner-email', 'print.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('E-00', 'Fresh profile: built-in server started and owner signed in', Boolean(ownerToken), API);

  // ================================================================== S1 sound assets in the production build
  const assets = await page.evaluate(async () => {
    const files = ['new-order', 'kitchen-ticket', 'order-ready', 'payment-success', 'payment-failed', 'alert'];
    const out = {};
    for (const f of files) {
      const a = new Audio(new URL(`sounds/${f}.wav`, document.baseURI).href);
      out[f] = await new Promise((resolve) => {
        a.addEventListener('loadedmetadata', () => resolve(Number.isFinite(a.duration) && a.duration > 0.1 ? `ok ${a.duration.toFixed(2)}s` : 'bad duration'));
        a.addEventListener('error', () => resolve(`error ${a.error?.code}`));
        setTimeout(() => resolve('timeout'), 8000);
      });
    }
    return { out, origin: location.protocol };
  });
  check('S1', 'All 6 sound files load in the production (file://) build', Object.values(assets.out).every((v) => v.startsWith('ok')) && assets.origin === 'file:', JSON.stringify(assets));

  // spy on every real <audio> playback so we can count plays and volumes
  await page.evaluate(() => {
    window.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const entry = { src: this.src.split('/').pop(), volume: this.volume };
      return orig.apply(this, arguments).then((r) => (window.__plays.push({ ...entry, ok: true }), r), (e) => (window.__plays.push({ ...entry, ok: false, err: e.name }), Promise.reject(e)));
    };
  });

  // ================================================================== S2 settings UI, no-gesture playback, volume
  await goto('#/settings');
  await page.getByTestId('sound-settings').waitFor({ timeout: 15000 });
  await page.getByTestId('sound-volume').fill('30');
  await page.getByTestId('sound-test-new_order').click();
  await waitFor(() => page.evaluate(() => window.__plays.length >= 1));
  const p1 = await page.evaluate(() => window.__plays.slice());
  check('S2', 'Sound plays with no user gesture and uses the volume setting (30%)', p1.length === 1 && p1[0].ok && p1[0].src === 'new-order.wav' && Math.abs(p1[0].volume - 0.3) < 0.01, JSON.stringify(p1));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('foodcourt.sound.v1')));
  check('S2b', 'Volume and switches are stored on this PC', stored.volume === 0.3 && stored.enabled === true, JSON.stringify(stored));

  // ================================================================== printer setup
  await goto('#/settings');
  await page.getByTestId('printers-section').waitFor({ timeout: 15000 });
  await page.getByTestId('receipt-transport').selectOption('network');
  await page.getByTestId('receipt-host').fill('127.0.0.1');
  await page.getByTestId('receipt-port').fill(String(receiptP.port));
  await page.getByTestId('receipt-paper').selectOption('80');
  await page.getByTestId('kot-transport').selectOption('network');
  await page.getByTestId('kot-host').fill('127.0.0.1');
  await page.getByTestId('kot-port').fill(String(kotP.port));
  await page.getByTestId('kot-paper').selectOption('58');
  await page.getByTestId('auto-print-kot').check();
  await page.getByTestId('printers-save').click();
  await page.getByTestId('printers-message').filter({ hasText: 'saved' }).waitFor({ timeout: 10000 });
  const cfg = await page.evaluate(() => window.desktop.getPrintConfig());
  check('P1a', 'Printer settings saved and reloaded from the main process', cfg.receipt.transport === 'network' && cfg.receipt.port === receiptP.port && cfg.kot.paperWidthMm === 58 && cfg.autoPrint.kotOnNewTicket === true, JSON.stringify(cfg.kot));

  await page.getByTestId('receipt-status-check').click();
  await page.getByTestId('receipt-status').waitFor({ timeout: 10000 });
  check('P1b', 'Printer check reports the listener as reachable, with the honest caveat', /OK/.test(await page.getByTestId('receipt-status').innerText()) && /does not prove/.test(await page.getByTestId('receipt-status').innerText()));

  await page.getByTestId('receipt-test').click();
  await waitFor(() => receiptP.jobs.length >= 1);
  const t0 = receiptP.text(0);
  check('P1c', 'Test print reached the receipt printer: init, ruler of 48 columns, cut', t0.startsWith('\x1b@') && t0.includes('1234567890'.repeat(4) + '12345678') && t0.endsWith('\x1dV\x00') && t0.includes('RECEIPT PRINTER TEST'), JSON.stringify(t0.slice(0, 60)));
  await page.getByTestId('kot-test').click();
  await waitFor(() => kotP.jobs.length >= 1);
  check('P1d', 'Kitchen test print uses the 58 mm profile (32-column ruler)', kotP.text(0).includes('1234567890'.repeat(3) + '12') && !kotP.text(0).includes('1234567890'.repeat(3) + '1234'), '');

  // ================================================================== data: two stalls, one order
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  await api(ownerToken, 'PUT', '/settings/business_profile', { name: 'Print Test Court', address: 'MG Road, Pune', phone: '9876543210' });
  const mkStall = async (name) => {
    const s = (await api(ownerToken, 'POST', '/stalls', { name: `${name} ${tag}`, code: `${name.slice(0, 2).toUpperCase()}${tag}` })).data;
    const c = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: s.id, name: `Cat ${name} ${tag}` })).data;
    return { s, c };
  };
  const A = await mkStall('Dosa');
  const B = await mkStall('Juice');
  const dosa = (await api(ownerToken, 'POST', '/menu', { stall_id: A.s.id, category_id: A.c.id, name: 'Masala Dosa', price: 80 })).data;
  const juice = (await api(ownerToken, 'POST', '/menu', { stall_id: B.s.id, category_id: B.c.id, name: 'Mosambi Juice', price: 60 })).data;
  await api(ownerToken, 'POST', '/staff', { name: 'Print Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;
  const place = async () => {
    const res = await api(cashierToken, 'POST', '/orders', {
      order_type: 'takeaway',
      notes: 'Pack separately',
      items: [{ menu_item_id: dosa.id, quantity: 2, special_instructions: 'less oil' }, { menu_item_id: juice.id, quantity: 1 }],
    });
    const o = res.data.order ?? res.data;
    return { id: o.id, number: o.order_number };
  };

  // ================================================================== P2 receipt through the UI, duplicate protection
  const order1 = await place();
  await goto('#/orders');
  await page.getByLabel(`Open ${order1.number}`).click();
  await page.getByRole('button', { name: /Print bill/ }).waitFor({ timeout: 15000 });
  const before = receiptP.jobs.length;
  await page.getByRole('button', { name: /Print bill/ }).click();
  await waitFor(() => receiptP.jobs.length > before);
  const r0 = receiptP.text(receiptP.jobs.length - 1);
  check('P2a', 'Bill printed on the receipt printer with business name, items and total', r0.includes('PRINT TEST COURT') && r0.includes('2 x Masala Dosa') && r0.includes('1 x Mosambi Juice') && /TOTAL\s+\d+\.\d\d/.test(r0) && r0.includes('UNPAID'), JSON.stringify(r0.slice(0, 120)));
  check('P2b', 'Receipt text is laid out for 80 mm: no line longer than 48 columns', r0.split('\n').every((l) => l.replace(/[\x00-\x1f]/g, '').length <= 52), '');
  page.once('dialog', (d) => d.dismiss()); // "already printed - print another copy?" -> No
  await page.getByRole('button', { name: /Print bill/ }).click();
  await sleep(1500);
  check('P2c', 'A second click does not print a second slip (asks first; declined)', receiptP.jobs.length === before + 1, `slips=${receiptP.jobs.length - before}`);
  let confirmMsg = '';
  page.once('dialog', (d) => {
    confirmMsg = d.message();
    d.accept();
  });
  await page.getByRole('button', { name: /Print bill/ }).click();
  await waitFor(() => receiptP.jobs.length === before + 2);
  check('P2d', 'Accepting prints a copy stamped COPY #1', receiptP.text(before + 1).includes('*** COPY #1 ***') && /Already printed/.test(confirmMsg), confirmMsg);

  // ================================================================== P3 stall-wise KOTs
  const kBefore = kotP.jobs.length;
  await page.getByTestId('print-kot-order').click();
  await waitFor(() => kotP.jobs.length >= kBefore + 2, 15000);
  const kots = kotP.jobs.slice(kBefore).map((b) => b.toString('latin1'));
  const dosaKot = kots.find((k) => k.includes('DOSA'));
  const juiceKot = kots.find((k) => k.includes('JUICE'));
  check('P3a', 'One kitchen ticket per stall was printed', kots.length === 2 && !!dosaKot && !!juiceKot, `tickets=${kots.length}`);
  check('P3b', "Dosa stall's KOT lists only dosa lines, with quantity, instruction and order note; no prices", !!dosaKot && dosaKot.includes('2 x Masala Dosa') && dosaKot.includes('less oil') && dosaKot.includes('Pack separately') && !dosaKot.includes('Mosambi') && !/\d+\.\d\d/.test(dosaKot.replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}.*|\d{1,2}:\d{2}.*/g, '')), JSON.stringify(dosaKot?.slice(0, 160)));
  check('P3c', "Juice stall's KOT lists only juice lines", !!juiceKot && /1 x Mosambi\s+Juice/.test(juiceKot) && !juiceKot.includes('Masala') && !juiceKot.includes('less oil'), JSON.stringify(juiceKot?.slice(0, 160)));
  page.once('dialog', (d) => d.dismiss());
  await page.getByTestId('print-kot-order').click();
  await sleep(1500);
  check('P3d', 'Printing the KOTs again does not repeat them without confirmation', kotP.jobs.length === kBefore + 2, `tickets=${kotP.jobs.length - kBefore}`);

  // ================================================================== S3 / P4 kitchen board: sound once + auto print once
  await page.evaluate(() => (window.__plays.length = 0));
  await goto('#/kitchen');
  await page.waitForFunction(() => document.querySelectorAll('[data-ticket]').length > 0, null, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const kAfterOpen = kotP.jobs.length;
  const playsOnOpen = await page.evaluate(() => window.__plays.filter((p) => p.src === 'kitchen-ticket.wav').length);
  check('S3a', 'Opening the Kitchen board with existing tickets plays nothing and prints nothing', playsOnOpen === 0 && kAfterOpen === kBefore + 2, `plays=${playsOnOpen} newKots=${kAfterOpen - kBefore - 2}`);
  const order2 = await place();
  // the owner's board shows ONE stall at a time, so only that stall's new ticket auto-prints on this PC
  const arrived = await waitFor(() => kotP.jobs.length >= kAfterOpen + 1, 25000);
  await sleep(9000); // two more poll cycles
  const playsAfter = await page.evaluate(() => window.__plays.filter((p) => p.src === 'kitchen-ticket.wav' && p.ok).length);
  check('S3b', 'A new ticket sounds once and does not repeat on later polls (and not once per stall twice)', playsAfter >= 1 && playsAfter <= 2, `plays=${playsAfter}`);
  const autoKots = kotP.jobs.slice(kAfterOpen).map((b) => b.toString('latin1'));
  check('P4', 'Auto-print: the displayed stall new ticket printed exactly once, only its own items, no repeats on later polls', !!arrived && autoKots.length === 1 && (autoKots[0].includes('DOSA') ? autoKots[0].includes('Masala') && !autoKots[0].includes('Mosambi') : autoKots[0].includes('Mosambi') && !autoKots[0].includes('Masala')), `newKots=${autoKots.length} ${JSON.stringify((autoKots[0] || '').slice(30, 80))}`);

  // ================================================================== S4 disabled sound
  await page.evaluate(() => (window.__plays.length = 0));
  await goto('#/settings');
  await page.getByTestId('sound-enabled').uncheck();
  await goto('#/kitchen');
  await sleep(1200);
  const order3 = await place();
  await sleep(9000);
  const playsDisabled = await page.evaluate(() => window.__plays.length);
  check('S4', 'With sound switched off a new ticket plays nothing', playsDisabled === 0, `plays=${playsDisabled}`);
  await goto('#/settings');
  await page.getByTestId('sound-enabled').check();

  // ================================================================== P5 printer unreachable -> failed -> retry
  await receiptP.stop();
  const order4 = await place();
  await goto('#/orders');
  await page.getByLabel(`Open ${order4.number}`).click();
  await page.getByRole('button', { name: /Print bill/ }).waitFor({ timeout: 15000 });
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: /Print bill/ }).click();
  const failed = await waitFor(async () => (await jobs()).find((j) => j.status === 'failed' && j.reference.orderNumber === order4.number));
  check('P5a', 'Unreachable printer: the job is FAILED with the reason, not completed', !!failed && /refused|reach|answer/i.test(failed.error?.message || '') && failed.error.ambiguous === false, JSON.stringify(failed?.error));
  await page.getByTestId('print-failure-banner').waitFor({ timeout: 8000 }).catch(() => {});
  const banner = await page.getByTestId('print-failure-banner').isVisible().catch(() => false);
  check('P5b', 'A failure banner is shown with a Retry button', banner && (await page.getByTestId('print-failure-retry').count()) >= 1, `visible=${banner}`);
  await waitFor(() => page.evaluate(() => window.__plays.some((p) => p.src === 'alert.wav')), 5000);
  await sleep(600);
  const alertPlays = await page.evaluate(() => window.__plays.filter((p) => p.src === 'alert.wav').length);
  check('P5c', 'The alert sound played once for the failed job', alertPlays === 1, `plays=${alertPlays}`);
  await receiptP.restart();
  const rBefore = receiptP.jobs.length;
  await page.getByTestId('print-failure-retry').first().click();
  await waitFor(() => receiptP.jobs.length > rBefore);
  await sleep(1500);
  const afterRetry = await jobs();
  const retried = afterRetry.find((j) => j.reference.orderNumber === order4.number && j.kind === 'receipt');
  check('P5d', 'Retry after recovery prints exactly once and the job becomes completed (2 attempts)', receiptP.jobs.length === rBefore + 1 && retried?.status === 'completed' && retried.attempts === 2, `slips=${receiptP.jobs.length - rBefore} status=${retried?.status} attempts=${retried?.attempts}`);

  // ================================================================== P6 persistence across restart
  const beforeRestart = (await jobs()).map((j) => `${j.id}:${j.status}`).sort();
  const jobsFile = join(profile, 'printing', 'jobs.json');
  check('P6a', 'Job history is persisted on disk', existsSync(jobsFile) && JSON.parse(readFileSync(jobsFile, 'utf8')).jobs.length === beforeRestart.length, jobsFile);
  await app.close();
  await launch();
  await page.waitForFunction(() => !!window.desktop?.listPrintJobs, null, { timeout: 30000 });
  const afterRestart = (await page.evaluate(() => window.desktop.listPrintJobs(100))).map((j) => `${j.id}:${j.status}`).sort();
  check('P6b', 'After an app restart the same jobs, with the same statuses, are listed', JSON.stringify(afterRestart) === JSON.stringify(beforeRestart), `${afterRestart.length} jobs`);
  const dup = await page.evaluate((n) => window.desktop.enqueuePrintJob({ role: 'kot', dedupeKey: 'kot:' + n, doc: { kind: 'kot', blocks: [{ t: 'text', text: 'x' }] } }), (await jobs()).find((j) => j.kind === 'kot' && j.dedupeKey)?.dedupeKey.split(':')[1]);
  check('P6c', 'Duplicate protection survives the restart (no new slip for an already printed ticket)', dup.ok === false && dup.code === 'DUPLICATE', JSON.stringify({ code: dup.code, reason: dup.reason }));

  const relevantErrors = pageErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource|frame-ancestors' is ignored/.test(e));
  check('E-99', 'No unexpected renderer errors', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('E-FATAL', 'Test run completed without an exception', false, err?.stack || err);
} finally {
  writeFileSync(join(outDir, 'sound-printer-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  await app?.close().catch(() => undefined);
  await receiptP.stop().catch(() => undefined);
  await kotP.stop().catch(() => undefined);
  const failedCount = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\n${results.length - failedCount}/${results.length} passed`);
  process.exit(failedCount ? 1 : 0);
}
