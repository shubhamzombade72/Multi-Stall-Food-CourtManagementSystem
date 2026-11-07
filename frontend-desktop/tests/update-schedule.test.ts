// The rules for silent installs: the window, the idle gate, key rotation, boot decisions and the pen-drive route.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const schedule = require('../electron/update/schedule.cjs');
const { createActivity } = require('../electron/update/activity.cjs');
const trust = require('../electron/update/trust.cjs');
const rel = require('../electron/update/releases.cjs');
const format = require('../electron/update/format.cjs');
const { createUpdateAgent } = require('../electron/update/agent.cjs');

const at = (h: number, m = 0, day = 7) => new Date(2026, 10, day, h, m);
const NIGHT = { start: '02:00', end: '05:00' };
const temp = () => mkdtempSync(join(tmpdir(), 'fc-sched-'));

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, pub: Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64') };
}

// ------------------------------------------------------------------ the window
test('window: inside, outside, and at its edges', () => {
  assert.equal(schedule.inWindow(at(1, 59), NIGHT), false);
  assert.equal(schedule.inWindow(at(2), NIGHT), true);
  assert.equal(schedule.inWindow(at(4, 59), NIGHT), true);
  assert.equal(schedule.inWindow(at(5), NIGHT), false);
  assert.equal(schedule.inWindow(at(14), NIGHT), false);
});

test('window: one that crosses midnight', () => {
  const w = { start: '22:00', end: '04:00' };
  assert.equal(schedule.inWindow(at(23), w), true);
  assert.equal(schedule.inWindow(at(1), w), true);
  assert.equal(schedule.inWindow(at(4), w), false);
  assert.equal(schedule.inWindow(at(21), w), false);
});

test('next window: later today, tomorrow, or now', () => {
  assert.equal(schedule.nextWindowStart(at(1), NIGHT).getTime(), at(2).getTime());
  assert.equal(schedule.nextWindowStart(at(14), NIGHT).getTime(), at(2, 0, 8).getTime());
  assert.equal(schedule.nextWindowStart(at(3), NIGHT).getTime(), at(3).getTime());
});

test('missed window: only when a whole window closed after it became ready', () => {
  assert.equal(schedule.windowMissed(at(1).getTime(), at(6).getTime(), NIGHT), true, 'ready before the window, PC off through it');
  assert.equal(schedule.windowMissed(at(14, 0, 6).getTime(), at(9).getTime(), NIGHT), true, 'ready yesterday afternoon, opened this morning');
  assert.equal(schedule.windowMissed(at(10).getTime(), at(14).getTime(), NIGHT), false, 'ready this morning, tonight is still to come');
  assert.equal(schedule.windowMissed(NaN, at(14).getTime(), NIGHT), false);
});

test('policy: anything unreadable falls back to the safe default', () => {
  assert.deepEqual(schedule.normalizePolicy(null), { mode: 'idle', window: NIGHT });
  assert.deepEqual(schedule.normalizePolicy({ mode: 'whenever', window: { start: '25:00', end: '05:00' } }), { mode: 'idle', window: NIGHT });
  assert.deepEqual(schedule.normalizePolicy({ mode: 'ask', window: { start: '03:00', end: '03:00' } }), { mode: 'ask', window: NIGHT }, 'an empty window is refused');
  assert.deepEqual(schedule.normalizePolicy({ mode: 'approve_once', window: { start: '23:00', end: '01:30' } }), { mode: 'approve_once', window: { start: '23:00', end: '01:30' } });
});

const decide = (over: Record<string, unknown> = {}) => schedule.automaticInstall({
  pending: { version: '1.3.0', ready_at: at(1).toISOString(), approved: false },
  policy: { mode: 'silent', window: NIGHT },
  currentVersion: '1.2.0',
  lastResult: null,
  now: at(3),
  trigger: 'tick',
  compareVersions: format.compareVersions,
  ...over,
});

test('automatic install: silent policy installs in the window and not outside it', () => {
  assert.equal(decide().install, true);
  assert.equal(decide({ now: at(14) }).reason, 'outside_window');
  assert.equal(decide({ pending: null }).reason, 'nothing_ready');
  assert.equal(decide({ currentVersion: '1.3.0' }).reason, 'not_newer');
});

test('automatic install: the owner\'s rule is respected', () => {
  assert.equal(decide({ policy: { mode: 'ask', window: NIGHT } }).reason, 'needs_owner');
  assert.equal(decide({ policy: { mode: 'approve_once', window: NIGHT } }).reason, 'needs_approval');
  assert.equal(decide({ policy: { mode: 'approve_once', window: NIGHT }, pending: { version: '1.3.0', ready_at: at(1).toISOString(), approved: true } }).install, true);
});

test('automatic install: a version that failed and rolled back is never retried by itself', () => {
  assert.equal(decide({ lastResult: { outcome: 'recovered', version: '1.3.0' } }).reason, 'failed_before');
  assert.equal(decide({ lastResult: { outcome: 'needs_developer', version: '1.3.0' } }).reason, 'failed_before');
  assert.equal(decide({ lastResult: { outcome: 'recovered', version: '1.2.9' } }).install, true, 'an older failure says nothing about this one');
});

test('automatic install: Remind Me Later holds it back, for that version, until the time is up', () => {
  const until = at(3).getTime() + 60_000;
  assert.equal(decide({ snooze: { version: '1.3.0', until } }).reason, 'snoozed');
  assert.equal(decide({ snooze: { version: '1.3.0', until }, trigger: 'start' }).install, false);
  assert.equal(decide({ snooze: { version: '1.3.0', until: at(3).getTime() - 1 } }).install, true, 'the time has passed');
  assert.equal(decide({ snooze: { version: '1.2.9', until } }).install, true, 'another version is not covered');
});

test('automatic install: PC off through the window catches up at the next start only', () => {
  const morning = { now: at(9), pending: { version: '1.3.0', ready_at: at(14, 0, 6).toISOString() } };
  assert.equal(decide({ ...morning, trigger: 'start' }).reason, 'window_missed');
  assert.equal(decide({ ...morning, trigger: 'start' }).install, true);
  assert.equal(decide({ ...morning, trigger: 'tick' }).install, false, 'never closes an open app in the morning');
  assert.equal(decide({ ...morning, trigger: 'task' }).install, false);
});

test('scheduled task: per user, no elevation, and it survives a space in the path', () => {
  const args = schedule.taskCreateArgs('C:\\Program Files\\MangalMurti POS\\MangalMurti POS.exe', { start: '02:30', end: '05:00' });
  assert.equal(args[args.indexOf('/ST') + 1], '02:30');
  assert.equal(args[args.indexOf('/TR') + 1], '"C:\\Program Files\\MangalMurti POS\\MangalMurti POS.exe" --fc-maintenance');
  assert.ok(!args.includes('/RU') && !args.includes('/RL'));
});

// ------------------------------------------------------------------ the idle gate
function gate(over: Record<string, unknown> = {}) {
  let t = 1_000_000;
  const activity = createActivity({ now: () => t, printBusy: async () => false, maintenanceBusy: () => false, openUpiCount: async () => 0, hasWindow: () => true, ...over });
  activity.rendererReport([]);
  return { activity, advance: (ms: number) => { t += ms; } };
}

test('idle gate: free when every signal agrees', async () => {
  assert.deepEqual(await gate().activity.evaluate(), { idle: true, reasons: [] });
});

test('idle gate: an open cart, payment or form blocks', async () => {
  const { activity } = gate();
  activity.rendererReport(['cart', 'payment', 'form']);
  const r = await activity.evaluate();
  assert.equal(r.idle, false);
  assert.deepEqual(r.reasons, ['unsaved_cart', 'unsaved_payment', 'unsaved_form']);
  activity.rendererReport([]);
  assert.equal((await activity.evaluate()).idle, true, 'and clears when the work is done');
});

test('idle gate: a sale being saved blocks, then a quiet period must pass', async () => {
  const { activity, advance } = gate({ quietMs: 120_000 });
  activity.requestStarted('r1', 'POST');
  assert.ok((await activity.evaluate()).reasons.includes('request_in_flight'));
  activity.requestFinished('r1');
  let r = await activity.evaluate();
  assert.deepEqual(r.reasons, ['recent_write']);
  advance(120_001);
  activity.rendererReport([]);
  r = await activity.evaluate();
  assert.equal(r.idle, true);
});

test('idle gate: the owner pressing Update Now skips only the quiet period', async () => {
  const { activity } = gate({ quietMs: 120_000 });
  activity.requestStarted('r3', 'POST');
  activity.requestFinished('r3');
  assert.deepEqual((await activity.evaluate()).reasons, ['recent_write']);
  assert.equal((await activity.evaluate({ ownerPressed: true })).idle, true);
  activity.rendererReport(['cart']);
  assert.deepEqual((await activity.evaluate({ ownerPressed: true })).reasons, ['unsaved_cart'], 'an open cart still blocks');
  activity.rendererReport([]);
  activity.requestStarted('r4', 'POST');
  assert.ok((await activity.evaluate({ ownerPressed: true })).reasons.includes('request_in_flight'), 'and so does a sale being saved');
});

test('idle gate: reading data does not count as activity', async () => {
  const { activity } = gate();
  activity.requestStarted('r2', 'GET');
  assert.equal((await activity.evaluate()).idle, true);
});

test('idle gate: open UPI, printing and backup each block alone', async () => {
  assert.deepEqual((await gate({ openUpiCount: async () => 1 }).activity.evaluate()).reasons, ['upi_payment_open']);
  assert.deepEqual((await gate({ printBusy: async () => true }).activity.evaluate()).reasons, ['print_jobs']);
  assert.deepEqual((await gate({ maintenanceBusy: () => true }).activity.evaluate()).reasons, ['backup_or_restore']);
});

test('idle gate: unknown means busy', async () => {
  const boom = async () => {
    throw new Error('no answer');
  };
  assert.deepEqual((await gate({ openUpiCount: boom }).activity.evaluate()).reasons, ['upi_unknown']);
  assert.deepEqual((await gate({ printBusy: boom }).activity.evaluate()).reasons, ['printing_unknown']);
  assert.deepEqual((await gate({ maintenanceBusy: boom }).activity.evaluate()).reasons, ['maintenance_unknown']);
  assert.deepEqual((await gate({ openUpiCount: async () => null }).activity.evaluate()).reasons, ['upi_unknown']);
  assert.ok((await gate({ hasWindow: () => { throw new Error('x'); } }).activity.evaluate()).reasons.includes('window_unknown'));
});

test('idle gate: a screen that went silent or crashed counts as busy, a closed window does not', async () => {
  const silent = gate({ rendererStaleMs: 60_000 });
  silent.advance(60_001);
  assert.deepEqual((await silent.activity.evaluate()).reasons, ['renderer_unknown']);

  const never = createActivity({ printBusy: async () => false, maintenanceBusy: () => false, openUpiCount: async () => 0, hasWindow: () => true });
  assert.deepEqual((await never.evaluate()).reasons, ['renderer_unknown'], 'never reported');

  const crashed = gate();
  crashed.activity.rendererGone();
  assert.deepEqual((await crashed.activity.evaluate()).reasons, ['renderer_crashed']);

  const closed = gate({ hasWindow: () => false });
  closed.activity.rendererGone();
  assert.equal((await closed.activity.evaluate()).idle, true);
});

test('idle gate: nothing in it looks at saved orders or pending bills', () => {
  const source = readFileSync(new URL('../electron/update/activity.cjs', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('*')).join('\n');
  assert.doesNotMatch(source, /orders|pending_bills|table/i);
});

// ------------------------------------------------------------------ key rotation
function trustLab() {
  const dir = temp();
  const root = keypair();
  const k1 = keypair();
  const k2 = keypair();
  const installedFile = join(dir, 'update-trust.json');
  const statementFile = join(dir, 'trust-statement.json');
  writeFileSync(installedFile, JSON.stringify({ root: { r1: root.pub }, keys: { k1: k1.pub } }));
  const statement = (body: Record<string, unknown>, signer = root.pem) => {
    const raw = JSON.stringify({ keys: {}, retired: [], issued_at: 'x', ...body });
    return { raw, signature: format.signManifest(raw, signer), keyId: 'r1' };
  };
  const apply = (s: { raw: string; signature: string; keyId: string }) => trust.applyStatement({ installedFile, statementFile, ...s });
  return { dir, root, k1, k2, installedFile, statementFile, statement, apply, resolved: () => trust.resolveTrust(installedFile, statementFile) };
}

test('rotation: a new key is added and the old one retired', () => {
  const lab = trustLab();
  assert.deepEqual(Object.keys(lab.resolved()), ['k1']);
  assert.equal(lab.apply(lab.statement({ version: 2, keys: { k2: lab.k2.pub }, retired: ['k1'] })).ok, true);
  assert.deepEqual(Object.keys(lab.resolved()), ['k2']);
  rmSync(lab.dir, { recursive: true, force: true });
});

test('rotation: a retired key can no longer sign, and a new one can', () => {
  const lab = trustLab();
  lab.apply(lab.statement({ version: 2, keys: { k2: lab.k2.pub }, retired: ['k1'] }));
  const raw = '{"format":1}';
  assert.equal(format.verifySignature(raw, format.signManifest(raw, lab.k1.pem), 'k1', lab.resolved()), false);
  assert.equal(format.verifySignature(raw, format.signManifest(raw, lab.k2.pem), 'k2', lab.resolved()), true);
  rmSync(lab.dir, { recursive: true, force: true });
});

test('rotation: an older statement cannot bring a retired key back', () => {
  const lab = trustLab();
  lab.apply(lab.statement({ version: 3, keys: { k2: lab.k2.pub }, retired: ['k1'] }));
  const older = lab.apply(lab.statement({ version: 2, keys: { k1: lab.k1.pub } }));
  assert.equal(older.ok, false);
  assert.match(older.problem, /older/);
  assert.deepEqual(Object.keys(lab.resolved()), ['k2']);
  rmSync(lab.dir, { recursive: true, force: true });
});

test('rotation: changed text, a wrong signer and an unknown root are refused', () => {
  const lab = trustLab();
  const good = lab.statement({ version: 2, keys: { k2: lab.k2.pub } });
  assert.equal(lab.apply({ ...good, raw: good.raw.replace('"version":2', '"version":9') }).ok, false);
  assert.equal(lab.apply(lab.statement({ version: 2 }, lab.k1.pem)).ok, false, 'a signing key cannot sign its own promotion');
  assert.equal(lab.apply({ ...good, keyId: 'unknown' }).ok, false);
  assert.equal(existsSync(lab.statementFile), false);
  rmSync(lab.dir, { recursive: true, force: true });
});

test('rotation: a tampered stored statement changes nothing', () => {
  const lab = trustLab();
  lab.apply(lab.statement({ version: 2, keys: { k2: lab.k2.pub }, retired: ['k1'] }));
  const stored = JSON.parse(readFileSync(lab.statementFile, 'utf8'));
  writeFileSync(lab.statementFile, JSON.stringify({ ...stored, raw: stored.raw.replace('k2', 'k9') }));
  assert.deepEqual(Object.keys(lab.resolved()), ['k1'], 'falls back to the installed keys');
  rmSync(lab.dir, { recursive: true, force: true });
});

test('rotation: with no root key shipped, no statement can ever apply', () => {
  const lab = trustLab();
  writeFileSync(lab.installedFile, JSON.stringify({ keys: { k1: lab.k1.pub } }));
  assert.equal(lab.apply(lab.statement({ version: 2 })).ok, false);
  rmSync(lab.dir, { recursive: true, force: true });
});

test('rotation: the loader and the agent read trust through the same function', () => {
  for (const file of ['../electron/loader.cjs', '../electron/update/wiring.cjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /trust\.resolveTrust\(/, file);
    assert.doesNotMatch(source, /\.keys \|\| \{\}/, `${file} no longer reads the key list itself`);
  }
});

// ------------------------------------------------------------------ boot decisions
test('boot: a newer installer wins over an older active release', () => {
  const active = { version: '1.3.1', state: 'confirmed' };
  assert.deepEqual(rel.decideBoot({ journal: null, active, installedVersion: '1.4.0' }), { action: 'run', release: null, trial: false, clearActive: true });
});

test('boot: an active release at or above the installed version keeps running', () => {
  const active = { version: '1.3.1', state: 'confirmed' };
  assert.equal(rel.decideBoot({ journal: null, active, installedVersion: '1.3.1' }).release, '1.3.1');
  assert.equal(rel.decideBoot({ journal: null, active, installedVersion: '1.3.0' }).release, '1.3.1');
  assert.equal(rel.decideBoot({ journal: null, active, installedVersion: '1.3.0' }).clearActive, undefined);
});

test('boot: an interrupted update and a release on trial are still dealt with first', () => {
  assert.equal(rel.decideBoot({ journal: { phase: 'MIGRATING' }, active: { version: '1.3.1', state: 'confirmed' }, installedVersion: '1.4.0' }).action, 'recover');
  assert.equal(rel.decideBoot({ journal: { phase: 'TRIAL' }, active: { version: '1.3.1', state: 'trial', boot_attempts: 0 }, installedVersion: '1.4.0' }).trial, true);
});

async function signedRelease(root: string, version: string, signer: { pem: string }, compatibility: Record<string, unknown>, keyId = 'k1') {
  const contents = Buffer.from('console.log("hello")');
  const staging = join(root, 'src');
  mkdirSync(staging, { recursive: true });
  const source = join(staging, 'x.js');
  writeFileSync(source, contents);
  const out = join(root, `payload-${version}.fcpkg`);
  const written = await format.writePayload([{ path: 'app/x.js', source }], out);
  const manifest = { format: 1, release_id: `rel-${version}`, version, source_version: null, package_type: 'full', compatibility, deleted_files: [], database: {}, signing: { algorithm: 'ed25519', key_id: keyId }, payload_sha256: written.payload_sha256, payload_size: written.payload_size, files: written.entries, tree: written.entries.map(({ path, sha256, size }: { path: string; sha256: string; size: number }) => ({ path, sha256, size })) };
  const raw = JSON.stringify(manifest);
  return { raw, signature: format.signManifest(raw, signer.pem), payload: out, contents };
}

test('boot: a release built for another Electron does not run', async () => {
  const root = temp();
  const key = keypair();
  const dirs = rel.layout(join(root, 'u'));
  const r = await signedRelease(root, '1.3.0', key, { electron_major: 44 });
  const dir = rel.releaseDir(dirs, '1.3.0');
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'x.js'), r.contents);
  writeFileSync(join(dir, 'release.json'), r.raw);
  writeFileSync(join(dir, 'release.sig'), r.signature);
  const trusted = { k1: key.pub };
  assert.equal((await rel.verifyReleaseForBoot(dirs, '1.3.0', trusted, 44)).ok, true);
  const other = await rel.verifyReleaseForBoot(dirs, '1.3.0', trusted, 45);
  assert.equal(other.ok, false);
  assert.match(other.problem, /Electron 44/);
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------ the agent
function agentLab(over: Record<string, unknown> = {}) {
  const root = temp();
  const dirs = rel.layout(join(root, 'u'));
  const key = keypair();
  const installs: string[] = [];
  let clock = at(3);
  const agent = createUpdateAgent({
    dirs,
    trusted: () => ({ k1: key.pub }),
    seal: (t: string) => Buffer.from(t),
    unseal: (b: Buffer) => b.toString(),
    getCurrentVersion: () => '1.2.0',
    getMode: () => 'embedded',
    getDataDir: () => root,
    getServerUrl: () => '',
    electronMajor: 44,
    installed: () => ({ version: '1.2.0', app: root, server: root }),
    startBootstrap: async (job: string) => {
      installs.push(job);
    },
    statfs: async () => ({ bavail: 1e9, bsize: 4096 }),
    activity: { evaluate: async () => ({ idle: true, reasons: [] }) },
    now: () => clock,
    ...over,
  });
  return { root, dirs, key, agent, installs, setClock: (d: Date) => { clock = d; }, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }) };
}

async function usbFolder(lab: ReturnType<typeof agentLab>, version = '1.3.0', signer = lab.key, compatibility: Record<string, unknown> = { platform: 'win32', electron_major: 44 }) {
  const r = await signedRelease(lab.root, version, signer, compatibility);
  const folder = join(lab.root, `usb-${version}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'manifest.json'), r.raw);
  writeFileSync(join(folder, 'manifest.sig'), r.signature);
  writeFileSync(join(folder, 'payload.fcpkg'), readFileSync(r.payload));
  return folder;
}

test('pen drive: a signed folder becomes ready, with no server and no registration', async () => {
  const lab = agentLab();
  const result = await lab.agent.prepareFromFolder(await usbFolder(lab));
  assert.deepEqual(result, { ok: true, version: '1.3.0' });
  const pending = lab.agent.usablePending();
  assert.equal(pending.source, 'file');
  assert.equal(pending.target_id, null);
  assert.ok(pending.payload_file.startsWith(lab.dirs.downloads), 'copied off the drive');
  assert.equal(lab.installs.length, 0, 'ready is not installed');
  lab.cleanup();
});

test('pen drive: a changed package, a wrong signer and an older version are refused', async () => {
  const lab = agentLab();
  const tampered = await usbFolder(lab);
  const bytes = readFileSync(join(tampered, 'payload.fcpkg'));
  bytes[0] ^= 0xff;
  writeFileSync(join(tampered, 'payload.fcpkg'), bytes);
  assert.equal((await lab.agent.prepareFromFolder(tampered)).ok, false);

  const stranger = keypair();
  assert.equal((await lab.agent.prepareFromFolder(await usbFolder(lab, '1.3.1', stranger))).code, 'signature');
  assert.equal((await lab.agent.prepareFromFolder(await usbFolder(lab, '1.1.0'))).code, 'downgrade');
  assert.equal((await lab.agent.prepareFromFolder(await usbFolder(lab, '1.4.0', lab.key, { electron_major: 45 }))).code, 'requires_full_installer');
  assert.equal((await lab.agent.prepareFromFolder(join(lab.root, 'nothing-here'))).ok, false);
  assert.equal(lab.agent.usablePending(), null);
  lab.cleanup();
});

test('idle rule: installs once nobody has used the PC for 2 minutes, at any hour', async () => {
  let quiet: number | null = 119;
  const lab = agentLab({ userIdleSeconds: () => quiet });
  lab.setClock(at(14));
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  assert.equal(lab.agent.publicState().policy.mode, 'idle', 'this is the rule with no setting saved');
  assert.deepEqual(await lab.agent.maintenanceTick(), { installed: false, reason: 'pc_in_use' });
  quiet = null;
  assert.equal((await lab.agent.maintenanceTick()).reason, 'pc_in_use', 'no reading counts as in use');
  assert.equal(lab.installs.length, 0);
  quiet = 120;
  assert.equal((await lab.agent.maintenanceTick()).installed, true);
  assert.equal(lab.installs.length, 1);
  lab.cleanup();
});

test('idle rule: unsaved work still holds it back, however long the PC has been quiet', async () => {
  const lab = agentLab({ userIdleSeconds: () => 99999, activity: { evaluate: async () => ({ idle: false, reasons: ['unsaved_cart'] }) } });
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  const tick = await lab.agent.maintenanceTick();
  assert.equal(tick.installed, false);
  assert.deepEqual(tick.reasons, ['unsaved_cart']);
  assert.equal(lab.installs.length, 0);
  lab.cleanup();
});

test('idle rule: installs while the app opens, and an update that failed is not retried', () => {
  const decideIdle = (over: Record<string, unknown>) => decide({ policy: { mode: 'idle', window: NIGHT }, ...over });
  assert.deepEqual(decideIdle({ trigger: 'start', now: at(14) }), { install: true, reason: 'app_opening' });
  assert.equal(decideIdle({ trigger: 'task', now: at(14) }).install, false, 'the scheduled task keeps to the night window');
  assert.equal(decideIdle({ trigger: 'task', now: at(3) }).install, true);
  assert.equal(decideIdle({ trigger: 'tick', lastResult: { outcome: 'recovered', version: '1.3.0' } }).reason, 'failed_before');
});

test('maintenance: installs by itself in the window and not before', async () => {
  const lab = agentLab();
  lab.agent.setPolicy({ mode: 'silent', window: NIGHT });
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  lab.setClock(at(14));
  assert.equal((await lab.agent.maintenanceTick()).installed, false);
  assert.equal(lab.installs.length, 0);
  lab.setClock(at(3));
  assert.equal((await lab.agent.maintenanceTick()).installed, true);
  assert.equal(lab.installs.length, 1);
  assert.equal(lab.agent.usablePending(), null, 'handed over');
  lab.cleanup();
});

test('maintenance: an open bill holds the install back, and it says why', async () => {
  let idle = false;
  const lab = agentLab({ activity: { evaluate: async () => (idle ? { idle: true, reasons: [] } : { idle: false, reasons: ['unsaved_cart'] }) } });
  lab.agent.setPolicy({ mode: 'silent', window: NIGHT });
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  const tick = await lab.agent.maintenanceTick();
  assert.equal(tick.installed, false);
  assert.deepEqual(tick.reasons, ['unsaved_cart']);
  assert.deepEqual(lab.agent.publicState().waitingFor, ['unsaved_cart']);
  assert.equal(lab.installs.length, 0);
  idle = true;
  assert.equal((await lab.agent.maintenanceTick()).installed, true, 'and goes ahead once the bill is finished');
  lab.cleanup();
});

test('maintenance: with no idle gate at all, nothing ever installs', async () => {
  const lab = agentLab({ activity: undefined });
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  assert.equal((await lab.agent.maintenanceTick()).installed, false);
  assert.equal((await lab.agent.updateNow()).code, 'busy');
  lab.cleanup();
});

test('update now: also refuses during open work', async () => {
  const lab = agentLab({ activity: { evaluate: async () => ({ idle: false, reasons: ['unsaved_payment'] }) } });
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  const r = await lab.agent.updateNow();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'busy');
  assert.equal(lab.installs.length, 0);
  lab.cleanup();
});

test('policy: approve once and ask are honoured, and the screen shows the install time', async () => {
  const lab = agentLab();
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  lab.setClock(at(14));
  assert.ok(lab.agent.publicState().pending.installAt, 'silent shows a time');

  lab.setClock(at(3));
  lab.agent.setPolicy({ mode: 'ask', window: NIGHT });
  assert.equal((await lab.agent.maintenanceTick()).reason, 'needs_owner');
  assert.equal(lab.agent.publicState().pending.installAt, null);
  assert.equal(lab.installs.length, 0);
  lab.cleanup();
});

test('a ready update already overtaken by an installer is dropped', async () => {
  let current = '1.2.0';
  const lab = agentLab({ getCurrentVersion: () => current });
  await lab.agent.prepareFromFolder(await usbFolder(lab));
  current = '1.3.0';
  assert.equal(lab.agent.usablePending(), null);
  lab.cleanup();
});
