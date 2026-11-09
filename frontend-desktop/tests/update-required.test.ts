// Mandatory updates: where "mandatory" may come from (signed release data only), what the required-update screen may start,
// and how download failures, retries and double presses behave. The real dialog and a real install are in e2e/update-required.e2e.mjs.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const rel = require('../electron/update/releases.cjs');
const format = require('../electron/update/format.cjs');
const { createUpdateAgent } = require('../electron/update/agent.cjs');

const FEED = 'https://github.com/dev/updates/releases/latest/download';
const temp = () => mkdtempSync(join(tmpdir(), 'fc-required-'));

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, pub: Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64') };
}

async function signedRelease(root: string, version: string, signer: { pem: string }, extra: Record<string, unknown> = {}) {
  const staging = join(root, `src-${version}`);
  mkdirSync(staging, { recursive: true });
  const source = join(staging, 'x.js');
  writeFileSync(source, `console.log("${version}")`);
  const out = join(root, `payload-${version}.fcpkg`);
  const written = await format.writePayload([{ path: 'app/x.js', source }], out);
  const manifest = {
    format: 1, release_id: `rel-${version}`, version, source_version: null, package_type: 'full', compatibility: { platform: 'win32', electron_major: 44 },
    deleted_files: [], database: {}, signing: { algorithm: 'ed25519', key_id: 'k1' }, payload_sha256: written.payload_sha256, payload_size: written.payload_size,
    files: written.entries, tree: written.entries.map(({ path, sha256, size }: { path: string; sha256: string; size: number }) => ({ path, sha256, size })),
    notes: { features: [`What is new in ${version}`] }, ...extra,
  };
  const raw = JSON.stringify(manifest);
  return { raw, signature: format.signManifest(raw, signer.pem), payload: out };
}

type Gate = { idle: boolean; reasons: string[] };
function agentLab({ root = temp(), key = keypair(), gate = { idle: true, reasons: [] } as Gate, fetchImpl, feed = '' }: { root?: string; key?: ReturnType<typeof keypair>; gate?: Gate; fetchImpl?: (url: string, o: any) => Promise<Response>; feed?: string } = {}) {
  const dirs = rel.layout(join(root, 'u'));
  const installs: string[] = [];
  const agent = createUpdateAgent({
    dirs,
    trusted: () => ({ k1: key.pub }),
    seal: (t: string) => Buffer.from(t),
    unseal: (b: Buffer) => b.toString(),
    getCurrentVersion: () => '1.2.0',
    getMode: () => 'embedded',
    getDataDir: () => root,
    getServerUrl: () => '',
    getFeedUrl: () => feed,
    fetchImpl: fetchImpl || (async () => { throw new Error('offline'); }),
    electronMajor: 44,
    installed: () => ({ version: '1.2.0', app: root, server: root }),
    startBootstrap: async (job: string) => {
      installs.push(job);
    },
    statfs: async () => ({ bavail: 1e9, bsize: 4096 }),
    activity: { evaluate: async () => gate },
  });
  return { root, dirs, key, agent, installs, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }) };
}

async function penDrive(lab: { root: string; key: { pem: string } }, version: string, extra: Record<string, unknown> = {}) {
  const r = await signedRelease(lab.root, version, lab.key, extra);
  const folder = join(lab.root, `usb-${version}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'manifest.json'), r.raw);
  writeFileSync(join(folder, 'manifest.sig'), r.signature);
  writeFileSync(join(folder, 'payload.fcpkg'), readFileSync(r.payload));
  return folder;
}

test('every newer signed release goes through the update screen, published with --required or not; nothing newer means no screen', async () => {
  const none = agentLab();
  assert.equal(none.agent.publicState().required, null);
  assert.equal((await none.agent.installRequired()).code, 'not_required', 'nothing to install, nothing installed');
  assert.equal(none.installs.length, 0);
  none.cleanup();

  const plain = agentLab();
  await plain.agent.prepareFromFolder(await penDrive(plain, '1.3.0'));
  assert.equal(plain.agent.publicState().required?.version, '1.3.0', 'an update published without --required also uses the screen');
  assert.equal((await plain.agent.installRequired()).ok, true);
  assert.equal(plain.installs.length, 1);
  plain.cleanup();

  const required = agentLab();
  await required.agent.prepareFromFolder(await penDrive(required, '1.3.0', { required: true }));
  const r = required.agent.publicState().required;
  assert.equal(r.version, '1.3.0');
  assert.equal(r.downloaded, true);
  assert.equal(r.failedBefore, false);
  assert.deepEqual(r.notes, { features: ['What is new in 1.3.0'] });
  required.cleanup();
});

test('a downloaded mandatory update is still enforced after a restart with no internet', async () => {
  const first = agentLab();
  await first.agent.prepareFromFolder(await penDrive(first, '1.3.0', { required: true }));
  // A new agent on the same folders is what the app has after a restart; its fetch always fails
  const again = agentLab({ root: first.root, key: first.key });
  assert.equal(again.agent.publicState().required?.version, '1.3.0');
  assert.equal(again.agent.publicState().required?.downloaded, true);
  first.cleanup();
});

test('a description edited on disk is not believed: no forged "required", no tampered release', async () => {
  const lab = agentLab();
  await lab.agent.prepareFromFolder(await penDrive(lab, '1.3.0'));
  const pending = JSON.parse(readFileSync(lab.dirs.pending, 'utf8'));
  const edited = JSON.stringify({ ...JSON.parse(readFileSync(pending.manifest_file, 'utf8')), required: true });
  writeFileSync(pending.manifest_file, edited);
  const restarted = agentLab({ root: lab.root, key: lab.key });
  assert.equal(restarted.agent.publicState().required, null, 'signature no longer matches');

  // Even re-signed by someone else, it is refused
  const stranger = keypair();
  writeFileSync(pending.signature_file, format.signManifest(edited, stranger.pem));
  const again = agentLab({ root: lab.root, key: lab.key });
  assert.equal(again.agent.publicState().required, null);
  assert.equal((await again.agent.installRequired()).code, 'not_required');
  lab.cleanup();
});

test('the screen installs past a half-typed form, but never past an open cart, payment or print job', async () => {
  for (const [reasons, installs] of [[['unsaved_form'], 1], [['unsaved_cart'], 0], [['unsaved_form', 'print_jobs'], 0], [['request_in_flight'], 0]] as const) {
    const lab = agentLab({ gate: { idle: false, reasons: [...reasons] } });
    await lab.agent.prepareFromFolder(await penDrive(lab, '1.3.0', { required: true }));
    const r = await lab.agent.installRequired();
    assert.equal(lab.installs.length, installs, reasons.join(','));
    if (!installs) {
      assert.equal(r.code, 'busy');
      assert.ok(!r.reasons.includes('unsaved_form'));
    }
    lab.cleanup();
  }
});

test('a release that failed and was rolled back is marked, so the screen cannot lock the PC in a loop', async () => {
  const lab = agentLab();
  await lab.agent.prepareFromFolder(await penDrive(lab, '1.3.0', { required: true }));
  writeFileSync(join(lab.dirs.state, 'last-result.json'), JSON.stringify({ outcome: 'recovered', version: '1.3.0', at: new Date().toISOString() }));
  assert.equal(lab.agent.publicState().required?.failedBefore, true);
  lab.cleanup();
});

test('from the online feed: a failed download says so and changes nothing, Retry then installs, and a second press does not start a second download', async () => {
  const lab0 = { root: temp(), key: keypair() };
  const release = await signedRelease(lab0.root, '1.3.0', lab0.key, { required: true });
  const payload = readFileSync(release.payload);
  let payloadWorks = false;
  let payloadRequests = 0;
  let release1: () => void = () => undefined;
  const fetchImpl = async (url: string) => {
    const name = url.split('/').at(-1);
    if (name === 'manifest.sig') return new Response(release.signature, { status: 200 });
    if (name === 'manifest.json') return new Response(release.raw, { status: 200 });
    payloadRequests += 1;
    if (!payloadWorks) throw new Error('network down');
    await new Promise<void>((r) => { release1 = r; setTimeout(r, 300); });
    return new Response(payload, { status: 200, headers: { 'Content-Length': String(payload.length) } });
  };
  const lab = agentLab({ ...lab0, fetchImpl, feed: FEED });
  const state = await lab.agent.check();
  // The check starts the background download, which fails while the network is down
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(state.required?.version, '1.3.0');
  assert.equal(state.required?.downloaded, false);

  const failed = await lab.agent.installRequired();
  assert.equal(failed.ok, false);
  assert.ok(failed.error, 'says why');
  assert.equal(lab.installs.length, 0);
  assert.equal(lab.agent.publicState().phase, 'idle', 'nothing left running');
  assert.equal(lab.agent.usablePending(), null, 'nothing half-downloaded is treated as ready');

  payloadWorks = true;
  const firstPress = lab.agent.installRequired();
  await new Promise((r) => setTimeout(r, 50));
  const secondPress = await lab.agent.installRequired();
  assert.equal(secondPress.code, 'running', 'a second press while downloading does not start another download');
  release1();
  const done = await firstPress;
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(lab.installs.length, 1);
  assert.equal(payloadRequests >= 2, true);
  lab.cleanup();
  rmSync(lab0.root, { recursive: true, force: true });
});
