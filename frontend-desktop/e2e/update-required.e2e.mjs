/**
 * Optional and mandatory updates on the real packaged `MangalMurti POS.exe`, end to end. The developer publishes with the real
 * publish tool to a local stand-in with GitHub Releases' behaviour (as in update-feed.e2e.mjs), signed with a throw-away key the
 * package trusts. Real GitHub is never contacted. Temp LOCALAPPDATA and profile, the scheduled task off, and the windows kept
 * off-screen, so a real install on this PC is never touched and nobody at the PC can press anything in them.
 *
 *   node e2e/update-required.e2e.mjs        (after pnpm build and pnpm prepare:server)
 */
import { _electron as electron } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(process.env.UPDATE_E2E_DIST || join(DESKTOP, 'dist'));
const SERVER = resolve(process.env.UPDATE_E2E_SERVER || join(DESKTOP, 'build-server'));
const SHOTS = join(DESKTOP, '..', 'qa', 'desktop', 'results', 'update-required');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 240)}]` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000, every = 500) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  return last;
};
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const killPid = (pid) => {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
};

const T = mkdtempSync(join(tmpdir(), 'fc-update-req-'));
const keyFile = join(T, 'key.pem');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const publicB64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');

// ------------------------------------------------------------------ GitHub Releases' behaviour, plus a switchable connection
const REPO = 'dev/pos-updates';
const github = { repo: false, releases: [], latest: null, payloadRequests: [], failPayload: false, slowPayload: false };
const rel = (id) => github.releases.find((r) => r.id === Number(id));
const host = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const send = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json ?? {}));
    };
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname.startsWith(`/${REPO}/releases/latest/download/`)) {
      const name = parts.at(-1);
      if (!github.latest || !rel(github.latest).assets[name]) return send(404);
      res.writeHead(302, { Location: `/file/${github.latest}/${name}` });
      return res.end();
    }
    if (parts[0] === 'file') {
      const file = rel(parts[1]).assets[parts[2]];
      const range = /bytes=(\d+)-/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      if (parts[2] === 'payload.fcpkg') {
        github.payloadRequests.push({ version: rel(parts[1]).tag, start });
        // The shop's connection drops: the package cannot be fetched
        if (github.failPayload) return req.socket.destroy();
      }
      const piece = file.subarray(start);
      res.writeHead(range ? 206 : 200, { 'Content-Length': piece.length, 'Content-Type': 'application/octet-stream' });
      if (parts[2] === 'payload.fcpkg' && github.slowPayload) {
        // A slow shop connection, so progress can be watched
        for (let at = 0; at < piece.length; at += 512 * 1024) {
          if (!res.write(piece.subarray(at, at + 512 * 1024))) await new Promise((r) => res.once('drain', r));
          await sleep(120);
        }
        return res.end();
      }
      return res.end(piece);
    }
    if (req.headers.authorization !== 'Bearer e2e-token') return send(401, { message: 'Bad credentials' });
    if (req.method === 'POST' && url.pathname === '/user/repos') {
      github.repo = true;
      return send(201, { name: JSON.parse(body).name, private: JSON.parse(body).private });
    }
    if (url.pathname.startsWith(`/repos/${REPO}`)) {
      if (!github.repo) return send(404, { message: 'Not Found' });
      const rest = url.pathname.slice(`/repos/${REPO}`.length);
      if (rest === '') return send(200, { private: false });
      let m;
      if ((m = /^\/releases\/tags\/(.+)$/.exec(rest))) return github.releases.some((r) => r.tag === m[1]) ? send(200, {}) : send(404);
      if (rest === '/releases' && req.method === 'POST') {
        const made = { id: Math.max(0, ...github.releases.map((r) => r.id)) + 1, tag: JSON.parse(body).tag_name, draft: JSON.parse(body).draft, assets: {} };
        github.releases.push(made);
        return send(201, { id: made.id });
      }
      if (rest === '/releases' && req.method === 'GET') return send(200, github.releases.map((r) => ({ id: r.id, tag_name: r.tag, draft: r.draft })));
      if ((m = /^\/releases\/(\d+)$/.exec(rest)) && req.method === 'DELETE') {
        github.releases = github.releases.filter((r) => r.id !== Number(m[1]));
        return send(204);
      }
      if ((m = /^\/releases\/(\d+)\/assets$/.exec(rest)) && req.method === 'GET') return send(200, []);
      if ((m = /^\/releases\/(\d+)\/assets$/.exec(rest))) {
        rel(m[1]).assets[url.searchParams.get('name')] = body;
        return send(201, {});
      }
      if ((m = /^\/releases\/(\d+)$/.exec(rest)) && req.method === 'PATCH') {
        rel(m[1]).draft = false;
        github.latest = Number(m[1]);
        return send(200, { html_url: `http://x/${rel(m[1]).tag}` });
      }
    }
    return send(404);
  });
});
await new Promise((r) => host.listen(0, '127.0.0.1', r));
const HOST = `http://127.0.0.1:${host.address().port}`;
const FEED = `${HOST}/${REPO}/releases/latest/download`;

// ------------------------------------------------------------------ the package, set up the way the real installer is
const electronCopy = join(T, 'electron');
cpSync(join(DESKTOP, 'electron'), electronCopy, { recursive: true });
const trustFile = join(electronCopy, 'update-trust.json');
writeFileSync(trustFile, JSON.stringify({ keys: { feed: publicB64 } }));
writeFileSync(join(electronCopy, 'app-config.json'), JSON.stringify({ apiBaseUrl: '', updateServerUrl: '', updateFeedUrl: FEED }));
const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = (n) => `${ma}.${mi}.${pa + n}`;
const config = pkg.build;
config.directories.output = join(T, 'out');
config.files = [{ from: DIST, to: 'dist' }, { from: electronCopy, to: 'electron' }, 'package.json', '!node_modules/**/*'];
config.extraResources = ['php', 'backend', 'router.php'].map((n) => ({ from: join(SERVER, n), to: `server/${n}` }));
const configFile = join(T, 'pack.json');
writeFileSync(configFile, JSON.stringify(config));
console.log('[required] building the package...');
const builder = spawnSync('npx', ['electron-builder', '--win', '--x64', '--dir', '--config', `"${configFile}"`], { cwd: DESKTOP, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
const UNPACKED = join(T, 'out', 'win-unpacked');
const EXE = join(UNPACKED, 'MangalMurti POS.exe');
if (!existsSync(EXE)) {
  console.error(builder.stdout?.slice(-1500), builder.stderr?.slice(-1500));
  process.exit(2);
}
// Smart App Control can block a freshly built unsigned exe. An exe Windows already allows, of the same Electron version, can stand
// in for it: the packaged app.asar, server and update files are still this build's.
if (process.env.UPDATE_E2E_HOST_EXE) cpSync(resolve(process.env.UPDATE_E2E_HOST_EXE), EXE);

// ------------------------------------------------------------------ the developer's side
const STORE = join(T, 'store');
function buildRelease(version, { required = false } = {}) {
  const tree = join(T, 'trees', version);
  mkdirSync(join(tree, 'app'), { recursive: true });
  cpSync(DIST, join(tree, 'app', 'dist'), { recursive: true });
  cpSync(electronCopy, join(tree, 'app', 'electron'), { recursive: true });
  writeFileSync(join(tree, 'app', 'package.json'), JSON.stringify({ ...pkg, version }));
  cpSync(join(UNPACKED, 'resources', 'server'), join(tree, 'server'), { recursive: true });
  const routes = join(tree, 'server', 'backend', 'routes', 'api.php');
  writeFileSync(routes, `${readFileSync(routes, 'utf8')}\nRoute::get('/release-marker', fn () => ['version' => '${version}']);\n`);
  const notes = join(T, `notes-${version}.json`);
  writeFileSync(notes, JSON.stringify({ features: [`Feature of ${version}`], security: required ? [`Security fix in ${version}`] : [] }));
  const built = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/build-release.mjs'), '--version', version, '--store', STORE, '--app-root', join(tree, 'app'), '--server-root', join(tree, 'server'), '--key', keyFile, '--key-id', 'feed', '--notes', notes, '--electron-major', '44', ...(required ? ['--required'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw new Error(`build ${version}: ${built.stderr}`);
}
const publish = (version) => new Promise((done) => {
  const child = spawn(process.execPath, [join(DESKTOP, 'scripts/release/publish-github.mjs'), '--repo', REPO, '--version', version, '--store', STORE, '--trust', trustFile, '--api', HOST, '--uploads', HOST, '--create'], { env: { ...process.env, GITHUB_TOKEN: 'e2e-token' } });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => done({ status, stderr }));
});

// ------------------------------------------------------------------ one customer's PC, in temp folders
const localAppData = join(T, 'local');
const profile = join(T, 'profile');
mkdirSync(localAppData);
mkdirSync(profile);
const updateRoot = join(localAppData, 'MangalMurti POS Updates');
const stateFile = (n) => join(updateRoot, 'state', n);
const logFile = join(updateRoot, 'logs', 'update.log');
// The idle threshold is out of reach, so nothing installs by itself while the test drives the buttons
const env = { ...process.env, LOCALAPPDATA: localAppData, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_UPDATE_NO_TASK: '1', FOODCOURT_UPDATE_IDLE_SECONDS: '999999999', FOODCOURT_UPDATE_CHECK_MS: '3600000', FOODCOURT_UPDATE_FIRST_CHECK_MS: '3600000', FOODCOURT_FIRST_BACKUP_DELAY_MS: '3600000', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const http = async (method, url, { token, body } = {}) => {
  const res = await fetch(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const logLines = () => {
  try {
    return readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const stopRunning = () => {
  const pid = logLines().filter((l) => /Program running/.test(l.msg)).at(-1)?.pid;
  if (pid) killPid(pid);
  const server = readJson(join(profile, 'server', 'server.pid'));
  if (server?.pid) killPid(server.pid);
};
const running = async () => {
  const server = readJson(join(profile, 'server', 'server.pid'));
  return server?.port ? `http://127.0.0.1:${server.port}/api` : null;
};
const marker = async () => {
  const api = await running();
  return api ? (await http('GET', `${api}/release-marker`).catch(() => ({ json: null }))).json?.version : null;
};
const confirmedAt = (version, timeout) => waitFor(() => {
  const a = readJson(stateFile('active.json'));
  return a?.version === version && a.state === 'confirmed' ? a : null;
}, timeout, 1000);
const offScreen = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => {
  w.setPosition(-4000, -4000);
  w.setFocusable(false);
  w.blur();
})).catch(() => undefined);
const owner = { email: 'required.owner@example.test', password: 'Str0ngPass99', name: 'Required Owner' };
const processes = [];
let failed = false;

try {
  // ---------------- the app, with an owner and some business data
  const app = await electron.launch({ executablePath: EXE, env, timeout: 120000 });
  processes.push(app.process().pid);
  const page = await app.firstWindow();
  await offScreen(app);
  await page.setViewportSize({ width: 1366, height: 768 });
  check('REQ-01', 'The real packaged exe starts', (await app.evaluate(({ app: a }) => a.isPackaged)) === true, pkg.version);
  const api = await waitFor(async () => (await page.evaluate(() => window.desktop.getConfig()).catch(() => null))?.apiBaseUrl, 90000);
  const setup = await http('POST', `${api}/setup/owner`, { body: { ...owner, password_confirmation: owner.password } });
  if (setup.status >= 300) throw new Error(`setup ${setup.status}`);
  const apiToken = (await http('POST', `${api}/auth/login`, { body: { email: owner.email, password: owner.password } })).json.data.token;
  await http('POST', `${api}/stalls`, { token: apiToken, body: { name: 'Before Stall', code: 'BEF' } });
  await page.reload();
  await page.waitForSelector('input[type=email]', { timeout: 60000 });
  await page.fill('input[type=email]', owner.email);
  await page.fill('input[type=password]', owner.password);
  await page.keyboard.press('Enter');
  await page.locator('#pin-new').waitFor({ timeout: 30000 });
  const pin = '482916'.slice(0, Number(await page.getAttribute('#pin-new', 'maxlength')));
  await page.fill('#pin-new', pin);
  await page.fill('#pin-confirm', pin);
  await page.getByRole('button', { name: /Save PIN/ }).click();
  await page.locator('aside nav').waitFor({ timeout: 30000 });

  // ---------------- an optional update: a notice the owner can put off
  const v1 = next(1);
  buildRelease(v1);
  if ((await publish(v1)).status !== 0) throw new Error('publish optional');
  await page.evaluate(() => window.desktop.updateCheck());
  // Owner's rule: every update uses the same screen, with Update Now as its only button
  const plainShown = await page.getByTestId('update-required-dialog').waitFor({ timeout: 60000 }).then(() => true, () => false);
  await page.getByTestId('update-required-now').waitFor({ timeout: 60000 }).catch(() => undefined);
  const plainButtons = plainShown ? await page.getByTestId('update-required-dialog').getByRole('button').allInnerTexts() : [];
  check('OPT-01', 'An update published without --required also shows the screen, with Update Now as its only button', plainShown && plainButtons.length === 1 && /Update Now/.test(plainButtons[0]) && (await page.getByTestId('update-required-version').innerText()) === v1, JSON.stringify(plainButtons));
  await page.screenshot({ path: join(SHOTS, '1-plain-update.png') });

  // ---------------- a mandatory update while the shop's connection is down
  const v2 = next(2);
  buildRelease(v2, { required: true });
  if ((await publish(v2)).status !== 0) throw new Error('publish required');
  github.failPayload = true;
  await page.evaluate(() => window.desktop.updateCheck());
  const dialog = page.getByTestId('update-required-dialog');
  const shown = await dialog.waitFor({ timeout: 60000 }).then(() => true, () => false);
  check('REQ-02', 'A mandatory update shows the required-update screen', shown);
  // The screen is already open for the earlier release; it refreshes once a second to the newer one
  await waitFor(async () => (await page.getByTestId('update-required-version').innerText().catch(() => '')) === v2, 30000);
  const text = shown ? await dialog.innerText() : '';
  check('REQ-03', 'It shows the current and new version from the update system, and the signed notes', (await page.getByTestId('update-required-current').innerText()) === pkg.version && (await page.getByTestId('update-required-version').innerText()) === v2 && /Security fix in/.test(text) && /Application Update Required/.test(text), `${pkg.version} -> ${v2}`);
  // The check starts a background download at once (here it fails, the connection is down); while it runs the screen shows its
  // progress instead of a button, so look at the buttons once it has stopped
  await page.getByTestId('update-required-now').waitFor({ timeout: 60000 }).catch(() => undefined);
  const buttons = await dialog.getByRole('button').allInnerTexts();
  check('REQ-04', 'Its only button is Update Now: no close, cancel, later or skip', buttons.length === 1 && /Update Now/.test(buttons[0]) && !/close|cancel|later|skip|dismiss|×/i.test(text), JSON.stringify(buttons));
  await page.screenshot({ path: join(SHOTS, '2-required-update.png') });
  await page.keyboard.press('Escape');
  await page.mouse.click(20, 20);
  await sleep(800);
  check('REQ-05', 'Escape and clicking outside do not close it', await dialog.isVisible());
  const behind = await page.evaluate(() => {
    const nav = document.querySelector('aside nav');
    return { inert: Boolean(nav?.closest('[inert]')), focusable: document.activeElement?.closest('[data-testid="update-required-dialog"]') !== null };
  });
  check('REQ-06', 'The application behind it cannot be used: it is inert', behind.inert, JSON.stringify(behind));
  const appearsOnSignIn = await (async () => {
    await page.reload();
    return page.getByTestId('update-required-dialog').waitFor({ timeout: 30000 }).then(() => true, () => false);
  })();
  check('REQ-07', 'After a reload, back at the sign-in or PIN screen, it is still there', appearsOnSignIn);

  // The download fails: a clear message and Retry, nothing changed
  await page.getByTestId('update-required-now').click();
  const errorShown = await page.getByTestId('update-required-error').waitFor({ timeout: 90000 }).then(() => true, () => false);
  const retry = errorShown ? await page.getByTestId('update-required-now').innerText() : '';
  const errorText = errorShown ? await page.getByTestId('update-required-error').innerText() : 'no error shown';
  // The optional release from before may be waiting; what matters is that the mandatory one is neither ready nor installed
  check('REQ-08', 'A failed download names the connection, offers Retry, and changes nothing', errorShown && /Retry/.test(retry) && /internet connection/i.test(errorText) && readJson(stateFile('pending.json'))?.version !== v2 && readJson(stateFile('active.json')) === null && (await page.getByTestId('update-required-dialog').isVisible()), errorText);
  await page.screenshot({ path: join(SHOTS, '3-required-download-failed.png') });

  // The connection is back, slow: Retry shows real progress, then installs, restarts and confirms
  github.failPayload = false;
  github.slowPayload = true;
  const requestsBefore = github.payloadRequests.length;
  const exited = new Promise((r) => app.process().once('exit', r));
  await page.getByTestId('update-required-now').click();
  const percents = new Set();
  let progressShot = false;
  await waitFor(async () => {
    const p = await page.getByTestId('update-required-percent').innerText().catch(() => null);
    if (p) percents.add(p);
    if (p && !progressShot && Number.parseInt(p, 10) >= 30) {
      progressShot = true;
      await page.screenshot({ path: join(SHOTS, '4-required-downloading.png') }).catch(() => undefined);
    }
    const s = await page.getByTestId('update-required-status').innerText().catch(() => '');
    return /Verifying|Installing|Restarting/.test(s) ? s : null;
  }, 240000, 200);
  await page.screenshot({ path: join(SHOTS, '5-required-installing.png') }).catch(() => undefined);
  const numeric = [...percents].map((p) => Number.parseInt(p, 10)).filter(Number.isFinite);
  check('REQ-09', 'Download progress is shown as a rising percentage', numeric.length >= 3 && Math.max(...numeric) > Math.min(...numeric), [...percents].join(' '));
  check('REQ-10', 'Only one download ran for the press', github.payloadRequests.length - requestsBefore === 1, github.payloadRequests.length - requestsBefore);
  await Promise.race([exited, sleep(180000)]);
  const confirmed = await confirmedAt(v2, 240000);
  check('REQ-11', 'Installed, restarted by itself, and the new version confirmed after the restart', Boolean(confirmed), JSON.stringify(readJson(stateFile('active.json'))));
  check('REQ-12', 'The new version is really running', (await marker()) === v2, await marker());
  const now = await running();
  const token = now ? (await http('POST', `${now}/auth/login`, { body: { email: owner.email, password: owner.password } })).json?.data?.token : null;
  const stalls = token ? (await http('GET', `${now}/stalls`, { token })).json : null;
  check('REQ-13', 'Business data and the sign-in survived the update', JSON.stringify(stalls || '').includes('Before Stall'));
  stopRunning();
  await sleep(2500);

  // ---------------- after the update: normal use, no screen
  const after = await electron.launch({ executablePath: EXE, env, timeout: 120000 });
  processes.push(after.process().pid);
  const afterPage = await after.firstWindow();
  await offScreen(after);
  await waitFor(async () => (await afterPage.evaluate(() => window.desktop.getConfig()).catch(() => null))?.apiBaseUrl, 90000);
  const afterState = await afterPage.evaluate(() => window.desktop.updateCheck());
  await sleep(1500);
  check('REQ-14', 'The app reports the new version, and the screen does not come back', afterState.currentVersion === v2 && !afterState.required && (await afterPage.getByTestId('update-required-dialog').count()) === 0, `${afterState.currentVersion}`);
  await afterPage.screenshot({ path: join(SHOTS, '6-after-update.png') });

  // ---------------- a forged "mandatory" release is not believed
  const v3 = next(3);
  buildRelease(v3, { required: true });
  if ((await publish(v3)).status !== 0) throw new Error('publish v3');
  const real = github.releases.at(-1).assets;
  const attacker = generateKeyPairSync('ed25519');
  real['manifest.sig'] = Buffer.from(sign(null, real['manifest.json'], attacker.privateKey).toString('base64'));
  const forged = await afterPage.evaluate(() => window.desktop.updateCheck());
  await sleep(1500);
  check('REQ-15', 'A mandatory release with a forged signature is refused: no screen, nothing downloaded', !forged.required && !forged.update && (await afterPage.getByTestId('update-required-dialog').count()) === 0 && !existsSync(stateFile('pending.json')), forged.error);
} catch (err) {
  failed = true;
  console.error(err);
  check('REQ', 'Script ran to the end', false, err.message);
}

if (failed || results.some((r) => !r.pass)) {
  for (const f of [logFile, join(profile, 'logs', 'desktop.log')]) {
    if (existsSync(f)) console.log(`--- ${f}\n${readFileSync(f, 'utf8').split('\n').filter((l) => !/renderer-console/.test(l)).slice(-30).join('\n')}`);
  }
}
stopRunning();
for (const pid of processes) killPid(pid);
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${T}*' -or $_.CommandLine -like '*${T}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
host.closeAllConnections();
host.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
await sleep(2000);
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${T}*' -or $_.CommandLine -like '*${T}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
try {
  if (bad.length || failed) console.log(`Test folder kept: ${T}`);
  else cmdRemove(T);
} catch (err) {
  console.log(`Temp folder left behind: ${err.message}`);
}
function cmdRemove(dir) {
  // Profile cache paths pass 260 characters, which a plain delete cannot remove
  spawnSync('cmd.exe', ['/c', 'rd', '/s', '/q', `\\\\?\\${dir}`], { stdio: 'ignore' });
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
process.exit(bad.length || failed ? 1 : 0);
