// The no-server update route: what an app does with whatever the host answers. The whole route on the real exe is e2e/update-feed.e2e.mjs.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createUpdateAgent, normalizeFeedUrl } = require('../electron/update/agent.cjs');
const rel = require('../electron/update/releases.cjs');

const FEED = 'https://github.com/dev/updates/releases/latest/download';
const { publicKey } = generateKeyPairSync('ed25519');
const trusted = { k1: Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64') };

function agentWith(fetchImpl: (url: string, options: any) => Promise<any>, feed = FEED, keys: Record<string, string> = trusted) {
  const root = mkdtempSync(join(tmpdir(), 'fc-feed-'));
  const dirs = rel.layout(root);
  const agent = createUpdateAgent({
    dirs,
    trusted: () => keys,
    fetchImpl,
    seal: (t: string) => Buffer.from(t),
    unseal: (b: Buffer) => b.toString(),
    getCurrentVersion: () => '1.3.0',
    getMode: () => 'embedded',
    getDataDir: () => root,
    getServerUrl: () => '',
    getFeedUrl: () => feed,
    electronMajor: 44,
    installed: () => ({ version: '1.3.0', app: root, server: root }),
    activity: { evaluate: async () => ({ idle: true, reasons: [] }) },
    startBootstrap: async () => undefined,
  });
  return { agent, dirs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const answer = (status: number, body = '') => new Response(status === 404 ? 'Not Found' : body, { status });

test('a feed address must be plain https, except to this PC', () => {
  assert.equal(normalizeFeedUrl(`${FEED}/`), FEED);
  assert.equal(normalizeFeedUrl('http://127.0.0.1:9000/feed'), 'http://127.0.0.1:9000/feed');
  for (const bad of ['http://updates.example/feed', 'https://user:pw@updates.example/feed', 'https://updates.example/feed?x=1', 'file:///c:/feed', 'not a url', 42]) {
    assert.equal(normalizeFeedUrl(bad), null, String(bad));
  }
});

test('a plain http feed blocks updates instead of being used', async () => {
  const lab = agentWith(async () => assert.fail('must not be contacted'), 'http://updates.example/feed');
  try {
    assert.match((await lab.agent.check()).blocked, /secure/);
  } finally {
    lab.cleanup();
  }
});

test('no registration is asked for, and an empty feed means up to date', async () => {
  const urls: string[] = [];
  const lab = agentWith(async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, undefined, 'no login goes to the host');
    assert.equal(options.redirect, 'follow', 'GitHub redirects to the file');
    return answer(404);
  });
  try {
    const state = await lab.agent.check();
    assert.equal(state.enrolled, true);
    assert.equal(state.blocked, null);
    assert.equal(state.update, null);
    assert.equal(state.error, null);
    assert.ok(state.checkedAt);
    assert.deepEqual(urls, [`${FEED}/manifest.sig`]);
  } finally {
    lab.cleanup();
  }
});

test('a host that is down leaves the software alone and says so', async () => {
  for (const fail of [async () => answer(503), async () => { throw new Error('offline'); }]) {
    const lab = agentWith(fail);
    try {
      const state = await lab.agent.check();
      assert.match(state.error, /could not be reached/);
      assert.equal(state.update, null);
    } finally {
      lab.cleanup();
    }
  }
});

test('anything with a bad signature is ignored, whatever it claims to be', async () => {
  const raw = JSON.stringify({ version: '9.9.9', signing: { key_id: 'k1' }, payload_sha256: 'x', payload_size: 1 });
  const attacker = generateKeyPairSync('ed25519');
  const forged = sign(null, Buffer.from(raw), attacker.privateKey).toString('base64');
  for (const [manifest, signature] of [[raw, forged], ['{not json', forged], [raw, 'garbage']]) {
    let payloadAsked = false;
    const lab = agentWith(async (url) => {
      if (url.endsWith('payload.fcpkg')) payloadAsked = true;
      return answer(200, url.endsWith('.sig') ? signature : manifest);
    });
    try {
      const state = await lab.agent.check();
      assert.equal(state.update, null);
      assert.match(state.error, /security check/);
      assert.equal(payloadAsked, false, 'the package is never downloaded');
      assert.equal(existsSync(lab.dirs.pending), false);
    } finally {
      lab.cleanup();
    }
  }
});

test('frequent looks do not keep reading the large file of a release that was refused', async () => {
  const { privateKey, publicKey: pub } = generateKeyPairSync('ed25519');
  const key = Buffer.from(pub.export({ format: 'jwk' }).x as string, 'base64url').toString('base64');
  const raw = JSON.stringify({ version: '1.3.0', signing: { key_id: 'k1' } });
  const signature = sign(null, Buffer.from(raw), privateKey).toString('base64');
  const asked: string[] = [];
  const lab = agentWith(async (url) => {
    const name = url.split('/').at(-1) as string;
    asked.push(name);
    return answer(200, name === 'manifest.sig' ? signature : raw);
  }, FEED, { k1: key });
  try {
    await lab.agent.check({ background: true });
    await lab.agent.check({ background: true });
    await lab.agent.check({ background: true });
    const descriptionReads = asked.filter((n) => n === 'manifest.json').length;
    assert.equal(descriptionReads, 1, asked.join(', '));
    assert.equal(asked.filter((n) => n === 'manifest.sig').length, 3);
  } finally {
    lab.cleanup();
  }
});

test('there is no install time on the feed: a saved night rule is removed and cannot be set again', () => {
  const lab = agentWith(async () => answer(404));
  try {
    mkdirSync(dirname(lab.dirs.policy), { recursive: true });
    writeFileSync(lab.dirs.policy, JSON.stringify({ mode: 'silent', window: { start: '02:00', end: '05:00' } }));
    assert.equal(lab.agent.publicState().policy.mode, 'idle', 'ignored');
    assert.equal(lab.agent.publicState().policyLocked, true);
    lab.agent.start();
    assert.equal(existsSync(lab.dirs.policy), false, 'removed, so the loader cannot use it either');
    assert.equal(lab.agent.setPolicy({ mode: 'ask', window: { start: '02:00', end: '05:00' } }).policy.mode, 'idle');
    assert.equal(existsSync(lab.dirs.policy), false);
  } finally {
    lab.cleanup();
  }
});
