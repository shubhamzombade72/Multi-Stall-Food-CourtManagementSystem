/**
 * The sidebar and the main content scroll independently (the page itself never scrolls).
 * Real Electron runtime, built-in SQLite server, brand-new profile, short window so both areas overflow. Test data only.
 *
 *   cd frontend-desktop && npm run build && node e2e/sidebar-scroll.e2e.mjs
 */
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 220)}]` : ''}`);
};
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-sidebar-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'sidebar-scroll');
mkdirSync(shots, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
let app;
let page;
let API = '';

const api = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return json;
};

const metrics = () =>
  page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main navigation"]');
    const main = document.querySelector('main');
    const aside = document.querySelector('aside');
    const links = nav ? [...nav.querySelectorAll('a')] : [];
    const last = links[links.length - 1];
    return {
      docScroll: document.documentElement.scrollHeight - window.innerHeight,
      winScrollY: window.scrollY,
      navOverflow: nav ? nav.scrollHeight - nav.clientHeight : -1,
      navTop: nav ? nav.scrollTop : -1,
      mainOverflow: main ? main.scrollHeight - main.clientHeight : -1,
      mainTop: main ? main.scrollTop : -1,
      asideTop: aside ? Math.round(aside.getBoundingClientRect().top) : -1,
      asideBottom: aside ? Math.round(aside.getBoundingClientRect().bottom) : -1,
      lastLinkBottom: last ? Math.round(last.getBoundingClientRect().bottom) : -1,
      innerHeight: window.innerHeight,
    };
  });

try {
  app = await electron.launch({
    args: [APP_DIR],
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' },
    timeout: 90000,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 560 }).catch(() => {});
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 120000 });
  await page.fill('#owner-name', 'Scroll Owner');
  await page.fill('#owner-email', 'scroll.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 30000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 30000 });
  const token = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('SB-00', 'Fresh profile: app started and owner signed in', Boolean(token), API);

  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  for (let i = 1; i <= 14; i++) await api(token, 'POST', '/stalls', { name: `Scroll Stall ${String(i).padStart(2, '0')}`, code: `SC${tag}${i}` });
  await page.evaluate(() => {
    location.hash = '#/stalls';
  });
  await page.getByTestId('stall-card').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);

  const m0 = await metrics();
  check('SB-01', 'The page itself does not scroll (shell is exactly the window height)', m0.docScroll <= 0 && m0.winScrollY === 0, `docScroll=${m0.docScroll}`);
  check('SB-02', 'Long content scrolls inside the main area', m0.mainOverflow > 50, `mainOverflow=${m0.mainOverflow}`);
  check('SB-03', 'The sidebar menu is taller than the window and scrolls on its own', m0.navOverflow > 20, `navOverflow=${m0.navOverflow}`);
  await page.screenshot({ path: join(shots, '1-initial.png') });

  // Scrolling the main content must not move the sidebar
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 100000;
  });
  const m1 = await metrics();
  check('SB-04', 'Scrolling the main content moves only the main content (sidebar stays put)', m1.mainTop > 0 && m1.navTop === 0 && m1.asideTop === m0.asideTop && m1.asideBottom === m0.asideBottom && m1.winScrollY === 0, `mainTop=${m1.mainTop} navTop=${m1.navTop} aside=${m1.asideTop}-${m1.asideBottom}`);
  await page.screenshot({ path: join(shots, '2-main-scrolled.png') });

  // Scrolling the sidebar must not move the main content, and every menu entry must be reachable
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
    document.querySelector('nav[aria-label="Main navigation"]').scrollTop = 100000;
  });
  const m2 = await metrics();
  check('SB-05', 'Scrolling the sidebar moves only the sidebar (main content stays put)', m2.navTop > 0 && m2.mainTop === 0 && m2.winScrollY === 0, `navTop=${m2.navTop} mainTop=${m2.mainTop}`);
  check('SB-06', 'The last menu entry can be scrolled into view inside the window', m2.lastLinkBottom > 0 && m2.lastLinkBottom <= m2.innerHeight, `lastLinkBottom=${m2.lastLinkBottom} of ${m2.innerHeight}`);
  await page.screenshot({ path: join(shots, '3-sidebar-scrolled.png') });

  // Mouse wheel over each area scrolls that area
  await page.evaluate(() => {
    document.querySelector('nav[aria-label="Main navigation"]').scrollTop = 0;
  });
  const box = await page.locator('nav[aria-label="Main navigation"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const m3 = await metrics();
  check('SB-07', 'Mouse wheel over the sidebar scrolls the sidebar only', m3.navTop > 0 && m3.mainTop === 0, `navTop=${m3.navTop} mainTop=${m3.mainTop}`);

  // The POS screen sizes itself to the window; it must still fit exactly (no extra scrollbar on the page or the main area)
  await page.evaluate(() => {
    location.hash = '#/pos';
  });
  await page.waitForTimeout(1500);
  const m4 = await metrics();
  await page.screenshot({ path: join(shots, '4-pos.png') });
  check('SB-08', 'POS screen fits the window: the page does not scroll and the main area has no stray overflow', m4.docScroll <= 0 && m4.mainOverflow <= 2, `docScroll=${m4.docScroll} mainOverflow=${m4.mainOverflow}`);
} catch (err) {
  check('SB-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 3).join(' '));
  try {
    if (page) await page.screenshot({ path: join(shots, 'failure.png') });
  } catch {}
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
