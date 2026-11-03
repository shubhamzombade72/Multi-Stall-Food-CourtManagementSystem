/**
 * End-to-end test of the Windows desktop app: drives the real Electron build through the full master-PRD
 * business workflow with UI clicks and verifies every step in PostgreSQL.
 *
 *   node e2e/electron-workflow.e2e.mjs "<path to FoodCourt Desktop.exe>"
 *
 * Requirements: the API for the isolated database running at E2E_API (default http://127.0.0.1:8120/api)
 * with backend/.env.mastere2e (DB foodcourt_master_e2e_db, seeded). The script refuses any other database.
 * It uses a throw-away Electron profile (FOODCOURT_USER_DATA_DIR) so a real install's settings are untouched.
 */
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXE = process.argv[2];
const API = process.env.E2E_API || 'http://127.0.0.1:8120/api';
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
if (!EXE || !existsSync(EXE)) throw new Error(`Pass the path of the packaged app executable (got: ${EXE})`);

const env = Object.fromEntries(
  readFileSync(join(ROOT, 'backend', '.env.mastere2e'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);
if (env.DB_DATABASE !== 'foodcourt_master_e2e_db') throw new Error('Refusing: not the isolated master E2E database');

// Demo password of the seeded accounts, read from the project's own seeder (test data only)
const SEED_PASSWORD = readFileSync(join(ROOT, 'backend', 'database', 'seeders', 'DatabaseSeeder.php'), 'utf8').match(/Hash::make\('([^']+)'\)/)[1];
const NEW_PASSWORD = 'E2eStaffPass#2026';

const sql = (q) =>
  execFileSync(PSQL, ['-h', env.DB_HOST, '-p', env.DB_PORT, '-U', env.DB_USERNAME, '-d', env.DB_DATABASE, '-tAc', q], {
    env: { ...process.env, PGPASSWORD: env.DB_PASSWORD },
    encoding: 'utf8',
  })
    .replace(/\r/g, '')
    .trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const results = [];
let section = '';
const sec = (s) => {
  section = s;
  console.log(`\n=== ${s} ===`);
};
const check = (id, desc, pass, ev = '') => {
  results.push({ section, id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 160)}]` : ''}`);
};

const run = Date.now().toString(36).slice(-5).toUpperCase();
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-e2e-'));
const shotsDir = join(ROOT, 'qa', 'staging', 'results', `electron-e2e-${run}`);
mkdirSync(shotsDir, { recursive: true });

let app;
let page;
const launch = async () => {
  app = await electron.launch({
    executablePath: EXE,
    env: { ...process.env, FOODCOURT_API_URL: API, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '' },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('dialog', (d) => d.accept()); // confirm()/alert() in the app
  page.setDefaultTimeout(20000);
  await page.waitForLoadState('domcontentloaded');
};
const shot = (name) => page.screenshot({ path: join(shotsDir, `${name}.png`) }).catch(() => undefined);
const go = (hash) => page.evaluate((h) => (location.hash = h), hash);
const waitHash = (frag) => page.waitForFunction((f) => location.hash.includes(f), frag);

const login = async (email, password) => {
  await go('#/login');
  await page.waitForSelector('input[type=email]');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => !location.hash.includes('login'));
  await page.waitForSelector('aside nav');
};
const logout = async () => {
  await page.click('[title="Sign Out"]');
  await waitHash('login');
};

(async () => {
  // ------------------------------------------------------------------ startup & security
  sec('Startup and Electron security');
  const t0 = Date.now();
  await launch();
  await page.waitForSelector('input[type=email]');
  const startupMs = Date.now() - t0;
  const sec1 = await page.evaluate(() => ({ req: typeof require, proc: typeof process, keys: Object.keys(window.desktop || {}).sort(), csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') }));
  check('S-01', 'Packaged app starts to the login screen', true, `${startupMs} ms`);
  check('S-02', 'Renderer has no Node access; bridge is the 8-function allowlist; CSP present', sec1.req === 'undefined' && sec1.proc === 'undefined' && sec1.keys.length === 8 && sec1.csp, JSON.stringify(sec1));
  const isPackaged = await app.evaluate(({ app: a }) => a.isPackaged);
  check('S-03', 'Running the packaged (asar) build', isPackaged === true);

  // ------------------------------------------------------------------ owner setup
  sec('Owner: food court, stall, staff, menu, tables');
  await login('owner@foodcourt.com', SEED_PASSWORD);
  check('O-01', 'Owner signs in and lands on the dashboard', (await page.evaluate(() => location.hash)) === '#/dashboard');
  const ownerNav = await page.locator('aside nav a').allInnerTexts();
  check('O-02', 'Owner sees every management section', ['Dashboard', 'Floor & Tables', 'Customers', 'Staff & Permissions', 'Reports & Audit', 'Food Court Settings'].every((l) => ownerNav.some((n) => n.includes(l))), ownerNav.join(', '));

  const courtName = `E2E Court ${run}`;
  await go('#/food-court-settings');
  await page.getByText('Business profile & operating hours').waitFor();
  const nameInput = page.locator('form').first().locator('input').first();
  await nameInput.fill(courtName);
  await page.fill('input[type=time] >> nth=0', '09:00');
  await page.fill('input[type=time] >> nth=1', '23:00');
  await page.click('text=Save business profile');
  await page.getByText('Business profile saved.').waitFor();
  await page.locator('header h1', { hasText: courtName }).waitFor();
  const savedProfile = sql(`SELECT value->>'name' || '|' || (value->>'opening_time') FROM settings WHERE key='business_profile'`);
  check('O-03', 'Food court profile saved (DB) and shown in the header', savedProfile === `${courtName}|09:00`, savedProfile);

  const stallName = `E2E Dosa ${run}`;
  const stallCode = `E2E-DOSA-${run}`;
  await go('#/stalls');
  await page.click('text=Add New Stall');
  await page.fill('input[placeholder="e.g., Taco Town"]', stallName);
  await page.fill('input[placeholder="e.g., STALL-TACO"]', stallCode);
  await page.click('button:has-text("Create Stall")');
  await page.getByText(stallName).first().waitFor();
  const stallId = Number(sql(`SELECT id FROM stalls WHERE code=${lit(stallCode)} AND is_active`));
  check('O-04', 'Owner creates a stall in the UI (DB: active stall)', stallId > 0, `stall ${stallId}`);

  const staff = {
    cashier: { name: `E2E Cashier ${run}`, email: `e2e.cashier.${run.toLowerCase()}@foodcourt.test`, role: 'cashier' },
    kitchen: { name: `E2E Chef ${run}`, email: `e2e.chef.${run.toLowerCase()}@foodcourt.test`, role: 'kitchen_staff', stall: stallName },
    waiter: { name: `E2E Waiter ${run}`, email: `e2e.waiter.${run.toLowerCase()}@foodcourt.test`, role: 'waiter' },
  };
  await go('#/staff');
  for (const s of Object.values(staff)) {
    await page.click('text=Add Staff');
    await page.fill('input[placeholder="Full name"]', s.name);
    await page.fill('input[placeholder="Email (login)"]', s.email);
    await page.fill('input[placeholder="Initial password (min 8 characters)"]', NEW_PASSWORD);
    await page.selectOption('select[aria-label="Role"]', s.role);
    if (s.stall) await page.selectOption('select[aria-label="Stall"]', { label: s.stall });
    await page.click('button[type=submit]:has-text("Create")');
    await page.locator('td', { hasText: s.email }).waitFor();
  }
  const staffRows = sql(`SELECT string_agg(role || ':' || COALESCE(stall_id::text,'-'), ',' ORDER BY role) FROM users WHERE email LIKE ${lit(`e2e.%.${run.toLowerCase()}@foodcourt.test`)}`);
  check('O-05', 'Owner creates cashier, kitchen (with stall) and waiter accounts (DB roles + stall)', staffRows === `cashier:-,kitchen_staff:${stallId},waiter:-`, staffRows);

  await go('#/menu');
  await page.click('text=+ Category');
  await page.selectOption('select[aria-label="Category stall"]', String(stallId));
  await page.fill('input[aria-label="Category name"]', 'Tiffin');
  await page.click('button[type=submit]:has-text("Add category")');
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const dishes = [
    ['Masala Dosa', '120'],
    ['Filter Coffee', '40'],
  ];
  for (const [dish, price] of dishes) {
    await page.click('text=Add New Dish');
    await page.selectOption('select[aria-label="Dish stall"]', String(stallId));
    await page.selectOption('select[aria-label="Dish category"]', { label: 'Tiffin' });
    await page.fill('input[placeholder="e.g. Gourmet Veg Supreme Pizza"]', `${dish} ${run}`);
    await page.fill('input[placeholder="250.00"]', price);
    await page.click('button[type=submit]:has-text("Add Dish")');
    await page.getByText(`${dish} ${run}`).first().waitFor();
  }
  const menuRows = sql(`SELECT string_agg(mi.name || '=' || mi.price || '@' || c.name, ',' ORDER BY mi.name) FROM menu_items mi JOIN menu_categories c ON c.id = mi.category_id WHERE mi.stall_id=${stallId}`);
  check('O-06', 'Owner adds a category and two dishes to the new stall (DB prices + category)', menuRows === `Filter Coffee ${run}=40.00@Tiffin,Masala Dosa ${run}=120.00@Tiffin`, menuRows);

  const tableNo = `E2E-${run}`;
  await go('#/tables');
  await page.click('text=Add Table');
  await page.locator('[role=dialog] input').nth(0).fill(tableNo);
  await page.locator('[role=dialog] input').nth(1).fill('4');
  await page.locator('[role=dialog] input').nth(2).fill('Terrace');
  await page.click('[role=dialog] button[type=submit]');
  await page.locator(`[data-table="${tableNo}"]`).waitFor();
  const tableRow = sql(`SELECT id || '|' || section || '|' || status FROM dining_tables WHERE table_number=${lit(tableNo)}`);
  const tableId = Number(tableRow.split('|')[0]);
  check('O-07', 'Owner creates a table in a new section (DB)', tableRow.endsWith('|Terrace|available'), tableRow);
  await shot('01-owner-tables');
  await logout();

  // ------------------------------------------------------------------ cashier order
  sec('Cashier POS: multi-stall table order');
  const other = sql(`SELECT mi.name || '|' || s.id || '|' || s.name FROM menu_items mi JOIN stalls s ON s.id = mi.stall_id WHERE mi.is_available AND s.is_active AND s.id <> ${stallId} AND s.code NOT LIKE 'E2E-%' ORDER BY mi.id LIMIT 1`).split('|');
  const [otherItem, otherStallId, otherStallName] = [other[0], Number(other[1]), other[2]];
  await login(staff.cashier.email, NEW_PASSWORD);
  check('C-01', 'New cashier signs in and lands on the POS', (await page.evaluate(() => location.hash)) === '#/pos');
  const cashierNav = await page.locator('aside nav a').allInnerTexts();
  check('C-02', 'Cashier menu hides owner-only sections', !cashierNav.some((n) => /Staff|Reports|Food Court Settings|Dashboard/.test(n)), cashierNav.join(', '));

  await page.waitForSelector(`[data-menu-item="Masala Dosa ${run}"]`);
  await page.click(`[data-menu-item="Masala Dosa ${run}"]`);
  await page.click(`[data-menu-item="Masala Dosa ${run}"]`);
  await page.click(`[data-menu-item="${otherItem}"] >> nth=0`);
  await page.selectOption('select[aria-label="Dining table"]', String(tableId));
  const phone = `98${String(Date.now()).slice(-8)}`;
  await page.fill('input[aria-label="Customer phone"]', phone);
  await page.fill('input[aria-label="Customer name"]', `E2E Guest ${run}`);
  await page.locator('input[aria-label="Customer phone"]').blur();
  await page.getByText('New customer').waitFor();
  await page.locator('label:has-text("Save to customers") input[type=checkbox]').check();
  await page.fill('input[aria-label="Order notes"]', `E2E run ${run}`);
  // double click: the button disables while sending and the idempotency key is per cart
  await page.dblclick('button:has-text("Send to Kitchen")');
  await page.getByText(/sent to 2 stall kitchen/).waitFor();
  const orderRow = sql(`SELECT id || '|' || order_number || '|' || status || '|' || order_channel || '|' || total_amount FROM orders WHERE notes=${lit(`E2E run ${run}`)}`);
  const orderCount = Number(sql(`SELECT COUNT(*) FROM orders WHERE notes=${lit(`E2E run ${run}`)}`));
  const [orderId, orderNumber, , channel, total] = orderRow.split('|');
  check('C-03', 'One parent order despite a double click (DB)', orderCount === 1 && channel === 'cashier_pos', orderRow);
  const tickets = sql(`SELECT string_agg(stall_id::text || ':' || status, ',' ORDER BY stall_id) FROM stall_kitchen_tickets WHERE order_id=${orderId}`);
  check('C-04', 'Order split into one kitchen ticket per stall (DB)', tickets.split(',').length === 2 && tickets.includes(`${stallId}:pending`) && tickets.includes(`${otherStallId}:pending`), tickets);
  const expectedSubtotal = (240 + Number(sql(`SELECT price FROM menu_items WHERE name=${lit(otherItem)} LIMIT 1`))).toFixed(2);
  check('C-05', 'Server priced the order (subtotal = menu prices)', sql(`SELECT subtotal FROM orders WHERE id=${orderId}`) === expectedSubtotal, expectedSubtotal);
  check('C-06', 'Table marked occupied and customer saved (DB)', sql(`SELECT status FROM dining_tables WHERE id=${tableId}`) === 'occupied' && sql(`SELECT name FROM customers WHERE phone=${lit(phone)}`) === `E2E Guest ${run}`);
  await shot('02-pos-order');
  await logout();

  // ------------------------------------------------------------------ kitchen
  sec('Kitchen display: stall isolation and preparation');
  await login(staff.kitchen.email, NEW_PASSWORD);
  check('K-01', 'Kitchen user lands on the KDS', (await page.evaluate(() => location.hash)) === '#/kitchen');
  const ownTicket = sql(`SELECT ticket_number FROM stall_kitchen_tickets WHERE order_id=${orderId} AND stall_id=${stallId}`);
  const otherTicket = sql(`SELECT ticket_number FROM stall_kitchen_tickets WHERE order_id=${orderId} AND stall_id=${otherStallId}`);
  const card = page.locator(`[data-ticket="${ownTicket}"]`);
  await card.waitFor();
  check('K-02', 'KDS shows the own-stall ticket and not the other stall ticket', (await page.locator(`[data-ticket="${otherTicket}"]`).count()) === 0, `${ownTicket} visible, ${otherTicket} hidden`);
  // wait for the card to show the NEXT step each time (the button reads "Updating…" while the request runs)
  const steps = [
    ['Accept', 'Start Preparing'],
    ['Start Preparing', 'Mark Ready'],
    ['Mark Ready', 'Waiting for pickup'],
  ];
  for (const [label, next] of steps) {
    await card.locator(`button:has-text("${label}")`).click();
    await card.getByText(next).waitFor();
  }
  check('K-03', 'Kitchen prepares its ticket to ready through the KDS buttons (DB)', sql(`SELECT status FROM stall_kitchen_tickets WHERE ticket_number=${lit(ownTicket)}`) === 'ready');
  const navKitchen = await page.locator('aside nav a').allInnerTexts();
  check('K-04', 'Kitchen user has no payment or POS screens', !navKitchen.some((n) => /POS|Payment|Orders/.test(n)), navKitchen.join(', '));
  await shot('03-kds');
  await logout();

  // The other stall's kitchen prepares its ticket (its own seeded kitchen account, through the API)
  const otherChef = sql(`SELECT email FROM users WHERE role='kitchen_staff' AND stall_id=${otherStallId} AND is_active LIMIT 1`);
  const tok = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: otherChef, password: SEED_PASSWORD }) })).json()).data.token;
  const otherTicketId = sql(`SELECT id FROM stall_kitchen_tickets WHERE ticket_number=${lit(otherTicket)}`);
  for (const status of ['accepted', 'preparing', 'ready']) {
    await fetch(`${API}/kitchen/tickets/${otherTicketId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ status }) });
  }
  check('K-05', `${otherStallName} kitchen marks its ticket ready (DB)`, sql(`SELECT status FROM stall_kitchen_tickets WHERE id=${otherTicketId}`) === 'ready');

  // ------------------------------------------------------------------ waiter
  sec('Waiter desktop: pickup and serving');
  await login(staff.waiter.email, NEW_PASSWORD);
  check('W-01', 'Waiter lands on the Waiter Station', (await page.evaluate(() => location.hash)) === '#/waiter');
  await page.click('button:has-text("Ready to Serve")');
  for (const t of [ownTicket, otherTicket]) {
    await page.locator(`[data-serve-ticket="${t}"]`).click();
    await page.locator(`[data-serve-ticket="${t}"]`).waitFor({ state: 'detached' });
  }
  const served = sql(`SELECT string_agg(status, ',') FROM stall_kitchen_tickets WHERE order_id=${orderId}`);
  check('W-02', 'Waiter confirms serving for both tickets; order becomes served (DB)', served === 'picked_up,picked_up' && sql(`SELECT status FROM orders WHERE id=${orderId}`) === 'served', served);
  await shot('04-waiter');
  await logout();

  // ------------------------------------------------------------------ cashier payment
  sec('Cashier: consolidated bill, payment, closing');
  await login(staff.cashier.email, NEW_PASSWORD);
  await page.click('button:has-text("Pending Table Bills")');
  await page.locator(`[data-settle-order="${orderNumber}"]`).click();
  await page.click('button[aria-pressed]:has-text("Cash")');
  await page.locator('input[type=number]').last().fill('1000');
  await page.click('button:has-text("Confirm Payment & Settle")');
  await page.getByText('Bill Settled Successfully').waitFor();
  const change = (1000 - Number(total)).toFixed(2);
  const pay = sql(`SELECT COUNT(*) || '|' || MAX(payment_method) || '|' || MAX(amount) || '|' || MAX(change_returned) FROM payments WHERE order_id=${orderId}`);
  check('P-01', 'One cash payment for the full bill with correct change (DB)', pay === `1|cash|${total}|${change}`, pay);
  check('P-02', 'Order paid and completed; table released (DB)', sql(`SELECT status || '|' || payment_status FROM orders WHERE id=${orderId}`) === 'completed|paid' && sql(`SELECT status FROM dining_tables WHERE id=${tableId}`) === 'available');
  await page.click('button:has-text("Close")');
  const cashierTok = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: staff.cashier.email, password: NEW_PASSWORD }) })).json()).data.token;
  const dup = await fetch(`${API}/billing/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${cashierTok}` }, body: JSON.stringify({ order_id: Number(orderId), payment_method: 'cash', amount: total, cash_tendered: 1000 }) });
  check('P-03', 'A second payment for the same bill is refused (422, still one payment row)', dup.status === 422 && sql(`SELECT COUNT(*) FROM payments WHERE order_id=${orderId}`) === '1', dup.status);
  // the API login above revoked the UI token (single session per user): sign in again
  await login(staff.cashier.email, NEW_PASSWORD);

  await go('#/payments');
  await page.getByText(orderNumber).first().waitFor();
  check('P-04', 'Payment appears in Payment History', true);
  await go('#/cashier-closing');
  await page.locator('[data-testid="expected-cash"]').waitFor();
  const expectedText = await page.locator('[data-testid="expected-cash"]').innerText();
  const expected = sql(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE cashier_id=(SELECT id FROM users WHERE email=${lit(staff.cashier.email)}) AND payment_method='cash'`);
  await page.locator('form input[type=number]').fill(expected);
  await page.click('button:has-text("Record closing")');
  await page.getByText('Cashier closing recorded.').waitFor();
  const closing = sql(`SELECT expected_cash || '|' || counted_cash || '|' || variance FROM cashier_closings WHERE cashier_id=(SELECT id FROM users WHERE email=${lit(staff.cashier.email)})`);
  check('P-05', 'Cashier closing: expected cash from payments, zero variance (DB)', closing === `${expected}|${expected}|0.00`, `${closing} (screen ${expectedText})`);
  const inHistory = await page.locator('td', { hasText: staff.cashier.name }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('P-06', 'The new closing appears in the closing history table', inHistory);
  await shot('05-cashier-closing');
  await logout();

  // ------------------------------------------------------------------ owner reports & closing
  sec('Owner: reports, notifications, daily closing');
  await login('owner@foodcourt.com', SEED_PASSWORD);
  await go('#/reports');
  await page.locator('role=tab[name="Stall Sales"]').click();
  await page.locator('td', { hasText: stallName }).waitFor();
  const stallRevenue = await page.locator('tr', { hasText: stallName }).locator('td').last().innerText();
  check('R-01', 'Stall sales report shows the new stall with its item revenue', stallRevenue === '240.00', stallRevenue);
  await page.locator('role=tab[name="Login & Access"]').click();
  await page.locator('td', { hasText: staff.cashier.name }).first().waitFor();
  check('R-02', 'Login history lists the new staff sign-ins', true);
  await page.locator('role=tab[name="Staff Activity"]').click();
  await page.locator('td', { hasText: staff.waiter.name }).waitFor();
  check('R-03', 'Staff activity report lists the waiter', true);
  await page.locator('[aria-label^="Notifications"]').click();
  await page.getByRole('dialog', { name: 'Notifications' }).getByText(`Payment ₹${total} received`).first().waitFor();
  check('R-04', 'Owner notification feed shows the payment', true);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);

  await go('#/settlements');
  await page.click('button:has-text("Execute End-of-Day Closing")');
  await page.getByText('Day Closed Successfully').waitFor();
  const dc = sql(`SELECT dc.id || '|' || r.stall_gross_sales FROM daily_closings dc JOIN stall_settlement_records r ON r.closing_id = dc.id WHERE r.stall_id=${stallId}`);
  check('R-05', 'Daily closing recorded with the new stall gross sales (DB)', dc.endsWith('|240.00'), dc);
  await shot('06-daily-closing');

  // ------------------------------------------------------------------ connectivity, persistence, restart
  sec('Disconnection, reconnection, restart');
  await go('#/settings');
  const urlInput = page.locator('#api-url');
  await urlInput.fill('http://127.0.0.1:8199/api');
  await page.click('button:has-text("Save & test")');
  await page.getByText(/refused the connection|could not be reached|did not respond/).first().waitFor();
  await page.reload();
  await page.getByText('Server unreachable').first().waitFor({ timeout: 30000 });
  check('N-01', 'Pointing at a dead server shows "Server unreachable"', true);
  await page.locator('#api-url').fill(API);
  await page.click('button:has-text("Save & test")');
  await page.getByText(/Food Court API found and responding/).waitFor();
  await page.reload();
  await page.getByText('Server online').waitFor({ timeout: 30000 });
  check('N-02', 'Reconnecting shows "Server online" again', true);
  const cfg = JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8'));
  check('N-03', 'API address persisted to the profile config file', cfg.apiBaseUrl === API, JSON.stringify(cfg));

  await app.close();
  await launch();
  await page.waitForSelector('aside nav');
  // the header name comes from the server settings, so its appearance proves the saved address works
  const reopened = await page.locator('header h1', { hasText: courtName }).waitFor({ timeout: 20000 }).then(() => true, () => false);
  const reopenedHash = await page.evaluate(() => location.hash);
  check('N-04', 'After closing and reopening the app the owner session and server address persist', reopened && reopenedHash === '#/dashboard', `${reopenedHash}, header ${await page.locator('header h1').innerText()}`);
  await logout();
  check('N-05', 'Logout returns to the sign-in screen', (await page.evaluate(() => location.hash)) === '#/login');
  await app.close();

  // ------------------------------------------------------------------ audit
  sec('Audit trail');
  const audit = sql(`SELECT string_agg(DISTINCT action, ',') FROM audit_logs WHERE created_at > (now() AT TIME ZONE 'UTC') - interval '1 hour' AND action IN ('settings_updated','staff_created','table_created','customer_created','order_created','payment_created','cashier_closed','daily_closing_created','login_success','logout')`);
  check('A-01', 'Settings, staff, table, customer, order, payment, closings and logins audited (DB)', audit.split(',').length === 10, audit);

  const pass = results.filter((r) => r.result === 'PASS').length;
  const fail = results.length - pass;
  writeFileSync(join(ROOT, 'qa', 'staging', 'results', 'electron-e2e.json'), JSON.stringify({ ran_at: new Date().toISOString(), exe: EXE, api: API, database: env.DB_DATABASE, run, order: orderNumber, pass, fail, results }, null, 2));
  console.log(`\nTOTAL: ${pass} PASS, ${fail} FAIL  (run ${run}, order ${orderNumber}, screenshots ${shotsDir})`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('E2E ERROR', e);
  await shot('error');
  await app?.close().catch(() => undefined);
  process.exit(3);
});
