/**
 * The no-server route, end to end, on the real `MangalMurti POS.exe`: the developer publishes with the real publish tool, and an
 * installed app with no registration receives it. The host is a local stand-in with GitHub Releases' behaviour: REST API, a
 * "latest" address that redirects to the file, and Range downloads. Real GitHub is not contacted.
 *
 * Temp LOCALAPPDATA and profile, throw-away key, and the app's scheduled task is switched off, so a real install on this PC, even
 * one that is running, is not touched.
 *
 *   UPDATE_E2E_DIST=<dist> UPDATE_E2E_SERVER=<prepared server> UPDATE_E2E_HOST_EXE=<an exe Windows allows> node e2e/update-feed.e2e.mjs
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

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 220)}]` : ''}`);
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

const T = mkdtempSync(join(tmpdir(), 'fc-update-feed-'));
const keyFile = join(T, 'key.pem');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const publicB64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');

// ------------------------------------------------------------------ GitHub Releases' behaviour
const REPO = 'dev/pos-updates';
const github = { repo: false, releases: [], latest: null, payloadRequests: [], feedAuth: 0, abortNextPayload: false, abortNextUpload: false, reads: { 'manifest.sig': 0, 'manifest.json': 0 } };
const rel = (id) => github.releases.find((r) => r.id === Number(id));
const host = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const send = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json ?? {}));
    };
    const parts = url.pathname.split('/').filter(Boolean);

    // what an installed app reads
    if (url.pathname.startsWith(`/${REPO}/releases/latest/download/`)) {
      if (req.headers.authorization) github.feedAuth += 1;
      const name = parts.at(-1);
      if (name in github.reads) github.reads[name] += 1;
      if (!github.latest || !rel(github.latest).assets[name]) return send(404);
      res.writeHead(302, { Location: `/file/${github.latest}/${name}` });
      return res.end();
    }
    if (parts[0] === 'file') {
      if (req.headers.authorization) github.feedAuth += 1;
      const file = rel(parts[1]).assets[parts[2]];
      const range = /bytes=(\d+)-/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      if (parts[2] === 'payload.fcpkg') github.payloadRequests.push({ version: rel(parts[1]).tag, start });
      const piece = file.subarray(start);
      res.writeHead(range ? 206 : 200, { 'Content-Length': piece.length, 'Content-Type': 'application/octet-stream' });
      if (parts[2] === 'payload.fcpkg' && github.abortNextPayload) {
        github.abortNextPayload = false;
        res.write(piece.subarray(0, Math.floor(piece.length / 4)), () => req.socket.destroy());
        return undefined;
      }
      return res.end(piece);
    }

    // what the developer's publish tool uses
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
        if (github.abortNextUpload && url.searchParams.get('name') === 'payload.fcpkg') {
          github.abortNextUpload = false;
          req.socket.destroy();
          return undefined;
        }
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
console.log('[feed] building the package...');
const builder = spawnSync('npx', ['electron-builder', '--win', '--x64', '--dir', '--config', `"${configFile}"`], { cwd: DESKTOP, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
const UNPACKED = join(T, 'out', 'win-unpacked');
const EXE = join(UNPACKED, 'MangalMurti POS.exe');
if (!existsSync(EXE)) {
  console.error(builder.stdout?.slice(-1500), builder.stderr?.slice(-1500));
  process.exit(2);
}
if (process.env.UPDATE_E2E_HOST_EXE) cpSync(resolve(process.env.UPDATE_E2E_HOST_EXE), EXE);

// ------------------------------------------------------------------ the developer's side
const STORE = join(T, 'store');
function buildRelease(version, { migration } = {}) {
  const tree = join(T, 'trees', version);
  mkdirSync(join(tree, 'app'), { recursive: true });
  cpSync(DIST, join(tree, 'app', 'dist'), { recursive: true });
  cpSync(electronCopy, join(tree, 'app', 'electron'), { recursive: true });
  writeFileSync(join(tree, 'app', 'package.json'), JSON.stringify({ ...pkg, version }));
  cpSync(join(UNPACKED, 'resources', 'server'), join(tree, 'server'), { recursive: true });
  const routes = join(tree, 'server', 'backend', 'routes', 'api.php');
  writeFileSync(routes, `${readFileSync(routes, 'utf8')}\nRoute::get('/release-marker', fn () => ['version' => '${version}']);\n`);
  if (migration) writeFileSync(join(tree, 'server', 'backend', 'database', 'migrations', '2050_01_01_000000_feed.php'), "<?php\n\nuse Illuminate\\Database\\Migrations\\Migration;\nuse Illuminate\\Database\\Schema\\Blueprint;\nuse Illuminate\\Support\\Facades\\Schema;\n\nreturn new class extends Migration\n{\n    public function up(): void\n    {\n        Schema::table('orders', function (Blueprint $t) { $t->string('feed_note')->nullable(); });\n    }\n};\n");
  const notes = join(T, `notes-${version}.json`);
  writeFileSync(notes, JSON.stringify({ features: [`Feature of ${version}`] }));
  const built = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/build-release.mjs'), '--version', version, '--store', STORE, '--app-root', join(tree, 'app'), '--server-root', join(tree, 'server'), '--key', keyFile, '--key-id', 'feed', '--notes', notes, '--electron-major', '44'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw new Error(`build ${version}: ${built.stderr}`);
}
// Not spawnSync: the stand-in host runs in this process and must keep answering
const publish = (version, extra = [], token = 'e2e-token') => new Promise((done) => {
  const child = spawn(process.execPath, [join(DESKTOP, 'scripts/release/publish-github.mjs'), '--repo', REPO, '--version', version, '--store', STORE, '--trust', trustFile, '--api', HOST, '--uploads', HOST, ...extra], { env: { ...process.env, GITHUB_TOKEN: token } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => done({ status, stdout, stderr }));
});

// ------------------------------------------------------------------ one customer's PC, in temp folders
const localAppData = join(T, 'local');
const profile = join(T, 'profile');
mkdirSync(localAppData);
mkdirSync(profile);
const updateRoot = join(localAppData, 'MangalMurti POS Updates');
const stateFile = (n) => join(updateRoot, 'state', n);
const logFile = join(updateRoot, 'logs', 'update.log');
// Idle threshold out of reach here, or a PC left alone during this test would update before the button steps run
const env = { ...process.env, LOCALAPPDATA: localAppData, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_UPDATE_NO_TASK: '1', FOODCOURT_UPDATE_IDLE_SECONDS: '999999999', FOODCOURT_UPDATE_CHECK_MS: '15000', FOODCOURT_UPDATE_FIRST_CHECK_MS: '3600000', FOODCOURT_FIRST_BACKUP_DELAY_MS: '3600000', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' };
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

const processes = [];
// A person sitting at this PC must not be able to press anything in the test's windows, and any exit or stall must be on record
const offScreen = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => {
  w.setPosition(-4000, -4000);
  w.setFocusable(false); // or typing elsewhere on this PC, and Alt+F4, can reach it
  w.blur();
})).catch(() => undefined);
const watch = (app, page, name) => {
  app.process().once('exit', (code, signal) => console.log(`[watch] ${new Date().toISOString()} ${name} process exit code=${code} signal=${signal}`));
  app.process().stdout?.on('data', (d) => String(d).split('\n').filter((l) => l.includes('[inside]')).forEach((l) => console.log(`[watch] ${new Date().toISOString()} ${name} ${l.trim()}`)));
  app.evaluate(({ app: a, BrowserWindow, powerMonitor }) => {
    const say = (what) => console.log(`[inside] ${what}`);
    a.on('before-quit', () => say(`before-quit ${new Error().stack.split('\n').slice(2, 5).join(' | ')}`));
    a.on('window-all-closed', () => say('window-all-closed'));
    BrowserWindow.getAllWindows().forEach((w) => {
      w.on('close', () => say('window close event'));
      w.on('session-end', () => say('windows session ending'));
      w.webContents.on('render-process-gone', (_e, d) => say(`renderer gone ${d.reason}`));
    });
    ['suspend', 'resume', 'shutdown', 'lock-screen', 'unlock-screen'].forEach((e) => powerMonitor.on(e, () => say(`power ${e}`)));
  }).catch(() => undefined);
  page.on('crash', () => console.log(`[watch] ${new Date().toISOString()} ${name} renderer crashed`));
  page.on('close', () => console.log(`[watch] ${new Date().toISOString()} ${name} page closed`));
};
let lastBeat = Date.now();
setInterval(() => {
  if (Date.now() - lastBeat > 10000) console.log(`[watch] ${new Date().toISOString()} this PC stalled or slept for ${Math.round((Date.now() - lastBeat) / 1000)} seconds`);
  lastBeat = Date.now();
}, 2000).unref();
const owner = { email: 'feed.owner@example.test', password: 'Str0ngPass99', name: 'Feed Owner' };
let failed = false;

try {
  // ---------------- the app before anything has been published
  const app = await electron.launch({ executablePath: EXE, env, timeout: 120000 });
  processes.push(app.process().pid);
  const page = await app.firstWindow();
  await offScreen(app);
  watch(app, page, 'first app');
  check('FEED-01', 'Real exe starts', (await app.evaluate(({ app: a }) => a.isPackaged)) === true);
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
  await page.fill('#pin-new', '482916');
  await page.fill('#pin-confirm', '482916');
  await page.getByRole('button', { name: /Save PIN/ }).click();
  await waitFor(() => page.evaluate(() => /dashboard|pos/i.test(location.hash)).catch(() => false), 30000);
  await page.evaluate(() => {
    location.hash = '#/updates';
  });
  await page.getByTestId('updates-page').waitFor({ timeout: 20000 });
  check('FEED-02', 'No registration, no install time to set, and updates are on', (await page.getByLabel('Update code').count()) === 0 && (await page.getByTestId('update-policy').count()) === 0 && (await page.getByTestId('update-disabled').count()) === 0);
  await page.getByRole('button', { name: 'Check now' }).click();
  await page.getByTestId('update-none').waitFor({ timeout: 20000 });
  check('FEED-03', 'Nothing published yet: says up to date, no error', true);

  // ---------------- the developer sends an update
  const v1 = next(1);
  buildRelease(v1, { migration: true });
  const denied = await publish(v1, [], 'wrong');
  check('FEED-04', 'A wrong GitHub login publishes nothing', denied.status !== 0 && /401/.test(denied.stderr) && github.releases.length === 0, denied.stderr.trim());
  const noRepo = await publish(v1);
  check('FEED-05', 'A missing repository is not created without --create', noRepo.status !== 0 && /--create/.test(noRepo.stderr) && !github.repo, noRepo.stderr.trim());
  github.abortNextUpload = true;
  const pub = await publish(v1, ['--create']);
  check('FEED-06', 'Developer publishes with the real tool, and a dropped upload is retried by itself', pub.status === 0 && github.latest === 1 && /trying again/.test(pub.stdout), pub.stderr || pub.stdout.trim().split('\n').at(-1));
  const again = await publish(v1);
  check('FEED-07', 'A published version cannot be replaced', again.status !== 0 && /already published/.test(again.stderr), again.stderr.trim());

  // ---------------- the app receives it. The first download breaks half way, as on a shop's connection
  github.abortNextPayload = true;
  await page.getByRole('button', { name: 'Check now' }).click();
  await page.getByTestId('update-available-version').waitFor({ timeout: 30000 });
  check('FEED-08', 'App offers the update with its notes', (await page.getByTestId('update-available-version').textContent()) === v1 && (await page.getByTestId('update-notes').textContent()).includes(`Feature of ${v1}`));
  const broke = await waitFor(async () => {
    const s = await page.evaluate(() => window.desktop.updateGetState());
    return s.phase === 'idle' && s.error ? s : null;
  }, 120000);
  check('FEED-21', 'The broken download is reported, with nothing changed', Boolean(broke) && !existsSync(stateFile('pending.json')), broke?.error);
  // Its own looks keep running, but a failed download waits an hour rather than being fetched again each time
  const requestsAfterBreak = github.payloadRequests.length;
  await sleep(50000);
  check('FEED-22', 'Frequent looks do not start the failed download again', github.payloadRequests.length === requestsAfterBreak, github.payloadRequests.length);
  await page.getByRole('button', { name: 'Check now' }).click();
  const ready = await waitFor(() => existsSync(stateFile('pending.json')), 240000, 1000);
  const resumed = github.payloadRequests.filter((r) => r.start > 0);
  check('FEED-09', 'Broken download resumed from where it stopped, and was verified', ready && resumed.length > 0, JSON.stringify(github.payloadRequests));
  check('FEED-10', 'No login or device token is ever sent to the host', github.feedAuth === 0, github.feedAuth);
  // Ready to install, inside the 02:00 to 05:00 hours if run then, and the PC is in use: at least two install ticks must pass with no install
  await sleep(130000);
  const stillOpen = await page.evaluate(() => window.desktop.updateGetState()).catch(() => null);
  check('FEED-23', 'A ready update does not install while the PC is in use', Boolean(stillOpen) && existsSync(stateFile('pending.json')) && stillOpen.currentVersion === pkg.version, JSON.stringify({ local: new Date().toTimeString().slice(0, 8), version: stillOpen?.currentVersion, rule: stillOpen?.policy?.mode }));

  if (!stillOpen) throw new Error('The app closed while it should have been waiting');
  const exited = new Promise((r) => app.process().once('exit', r));
  await page.getByTestId('update-now').click();
  await page.getByTestId('update-confirm-yes').click();
  await Promise.race([exited, sleep(180000)]);
  const first = await confirmedAt(v1, 240000);
  check('FEED-11', 'Installed, restarted and confirmed on the real exe', Boolean(first), JSON.stringify(readJson(stateFile('active.json')) ?? readJson(stateFile('journal.json'))));
  if (!first) console.log(logLines().slice(-15).map((l) => l.msg).join('\n'));
  check('FEED-12', 'The new backend is really running', (await marker()) === v1, await marker());
  const after = await running();
  const afterToken = (await http('POST', `${after}/auth/login`, { body: { email: owner.email, password: owner.password } })).json?.data?.token;
  const stalls = (await http('GET', `${after}/stalls`, { token: afterToken })).json;
  check('FEED-13', 'Business data survived the update', JSON.stringify(stalls).includes('Before Stall'));
  stopRunning();
  await sleep(2500);

  // ---------------- send and forget: nobody touches the app
  const v2 = next(2);
  buildRelease(v2);
  // An old PC's saved night rule, at an hour outside its window, must not hold it back. Only the waits are shortened: look every
  // 5 seconds, not 5 minutes, and need no quiet time
  const hour = (new Date().getHours() + 6) % 24;
  writeFileSync(stateFile('policy.json'), JSON.stringify({ mode: 'silent', window: { start: `${String(hour).padStart(2, '0')}:00`, end: `${String(hour).padStart(2, '0')}:30` } }));
  const quiet = await electron.launch({ executablePath: EXE, env: { ...env, FOODCOURT_UPDATE_FIRST_CHECK_MS: '2000', FOODCOURT_UPDATE_CHECK_MS: '5000', FOODCOURT_UPDATE_IDLE_SECONDS: '0' }, timeout: 120000 });
  processes.push(quiet.process().pid);
  const quietPage = await quiet.firstWindow();
  await offScreen(quiet);
  watch(quiet, quietPage, 'quiet app');
  check('FEED-14', 'App came back up on the updated version', (await quietPage.evaluate(() => window.desktop.updateGetState()).catch(() => null))?.currentVersion === v1);
  // Several looks at a release this app already has
  const readsBefore = { ...github.reads };
  await waitFor(() => github.reads['manifest.sig'] >= readsBefore['manifest.sig'] + 4, 60000);
  const sigLooks = github.reads['manifest.sig'] - readsBefore['manifest.sig'];
  check('FEED-20', 'Repeated looks read only the tiny signature file, not the large one', sigLooks >= 4 && github.reads['manifest.json'] - readsBefore['manifest.json'] <= 1, JSON.stringify({ sigLooks, large: github.reads['manifest.json'] - readsBefore['manifest.json'] }));
  const pub2 = await publish(v2);
  check('FEED-15', 'Second update published while the app sits idle', pub2.status === 0, pub2.stderr);
  const quietExit = new Promise((r) => quiet.process().once('exit', r));
  await Promise.race([quietExit, sleep(420000)]);
  const second = await confirmedAt(v2, 240000);
  check('FEED-16', 'Noticed, downloaded and installed by itself: no clicks, no check pressed, daytime included', Boolean(second), JSON.stringify(readJson(stateFile('active.json'))));
  if (!second) console.log(logLines().slice(-15).map((l) => l.msg).join('\n'));
  check('FEED-17', 'The silently installed backend is running', (await marker()) === v2, await marker());
  stopRunning();
  await sleep(2500);

  // ---------------- nobody but the developer can send one
  const v3 = next(3);
  buildRelease(v3);
  const pub3 = await publish(v3);
  if (pub3.status !== 0) throw new Error(pub3.stderr);
  const real = github.releases.at(-1).assets;
  const honest = { ...real };
  const attacker = generateKeyPairSync('ed25519');
  real['manifest.sig'] = Buffer.from(sign(null, real['manifest.json'], attacker.privateKey).toString('base64'));
  const guarded = await electron.launch({ executablePath: EXE, env, timeout: 120000 });
  processes.push(guarded.process().pid);
  const guardedPage = await guarded.firstWindow();
  await offScreen(guarded);
  watch(guarded, guardedPage, 'guarded app');
  await waitFor(async () => (await guardedPage.evaluate(() => window.desktop.getConfig()).catch(() => null))?.apiBaseUrl, 90000);
  const forged = await guardedPage.evaluate(() => window.desktop.updateCheck());
  check('FEED-18', 'A release signed with another key is refused and not offered', !forged.update && !existsSync(stateFile('pending.json')), forged.error);

  real['manifest.sig'] = honest['manifest.sig'];
  const before = github.payloadRequests.length;
  const payload = Buffer.from(honest['payload.fcpkg']);
  payload[payload.length - 100] ^= 0xff;
  real['payload.fcpkg'] = payload;
  await guardedPage.evaluate(() => window.desktop.updateCheck());
  await waitFor(() => github.payloadRequests.length > before, 30000);
  await waitFor(async () => (await guardedPage.evaluate(() => window.desktop.updateGetState())).phase === 'idle', 240000, 1000);
  check('FEED-19', 'A changed package is refused after download', !existsSync(stateFile('pending.json')) && readJson(stateFile('active.json'))?.version === v2, (await guardedPage.evaluate(() => window.desktop.updateGetState())).error);
} catch (err) {
  failed = true;
  console.error(err);
  check('FEED', 'Script ran to the end', false, err.message);
}

if (failed || results.some((r) => !r.pass)) {
  for (const f of [logFile, join(profile, 'logs', 'desktop.log')]) {
    if (existsSync(f)) console.log(`--- ${f}\n${readFileSync(f, 'utf8').split('\n').filter((l) => !/renderer-console/.test(l)).slice(-40).join('\n')}`);
  }
}
stopRunning();
for (const pid of processes) killPid(pid);
// A bootstrapper may have restarted the app after the kills above: anything still running from this test's folder goes too
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${T}*' -or $_.CommandLine -like '*${T}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
host.closeAllConnections();
host.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
await sleep(2000);
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${T}*' -or $_.CommandLine -like '*${T}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
await sleep(1000);
try {
  if (bad.length || failed) console.log(`Test folder kept: ${T}`);
  else rmSync(T, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch (err) {
  console.log(`Temp folder left behind: ${err.message}`);
}
process.exit(bad.length || failed ? 1 : 0);
