/**
 * Device sign-in vault (electron/auth-vault.cjs): PIN storage, attempt limits, tampering and recovery.
 * The OS seal is replaced by a keyed stand-in that fails on any change, as DPAPI does. The real DPAPI path runs in
 * e2e/pin-login.e2e.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNewPin as rendererCheck } from '../src/lib/pin.ts';

const require = createRequire(import.meta.url);
const { createAuthVault, checkNewPin, MAX_ATTEMPTS, DELAYS_MS, LOCKOUTS_MS, MAX_TOTAL_FAILURES } = require('../electron/auth-vault.cjs');

const PIN = '482916';
const TOKEN = '17|abcdefghijklmnopqrstuvwxyz0123456789';
const ACCOUNT = { id: 7, name: 'Priya Sharma', email: 'priya@example.com', role: 'owner', phone: 'dropped' };
const SEAL_KEY = crypto.randomBytes(32);

const seal = (text: string) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
};
const unseal = (data: Buffer) => {
  const d = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, data.subarray(0, 12));
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString('utf8');
};

const makeVault = (overrides: Record<string, unknown> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-vault-'));
  const file = join(dir, 'auth-vault.json');
  const clock = { t: 1_800_000_000_000 };
  const logs: string[] = [];
  const sealedTexts: string[] = [];
  const vault = createAuthVault({
    file,
    isAvailable: () => true,
    seal: (text: string) => {
      sealedTexts.push(text);
      return seal(text);
    },
    unseal,
    now: () => clock.t,
    log: (level: string, message: string) => logs.push(`${level} ${message}`),
    kdf: { N: 2 ** 10, r: 8, p: 1 },
    ...overrides,
  });
  return { vault, file, clock, logs, sealedTexts, done: () => rmSync(dir, { recursive: true, force: true }) };
};

const readRecord = (file: string) => JSON.parse(unseal(Buffer.from(JSON.parse(readFileSync(file, 'utf8')).sealed, 'base64')));
const writeRecord = (file: string, record: unknown) => writeFileSync(file, JSON.stringify({ v: 1, sealed: seal(JSON.stringify(record)).toString('base64') }));

/** Enter a wrong PIN and move the clock past the delay it earned. */
const failOnce = async (ctx: ReturnType<typeof makeVault>) => {
  const r = await ctx.vault.unlock('000001');
  ctx.clock.t += r.retryAfterMs ?? 0;
  return r;
};

test('with nothing saved, the status is none and unlock refuses', async () => {
  const ctx = makeVault();
  assert.deepEqual(await ctx.vault.status(), { state: 'none' });
  assert.equal((await ctx.vault.unlock(PIN)).code, 'no_vault');
  ctx.done();
});

test('the correct PIN releases the session; the status shows only what the PIN screen needs', async () => {
  const ctx = makeVault();
  assert.equal((await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT })).ok, true);
  const st = await ctx.vault.status();
  assert.equal(st.state, 'ready');
  assert.equal(st.pinLength, 6);
  assert.deepEqual(st.account, { id: 7, name: 'Priya Sharma', email: 'priya@example.com', role: 'owner' });
  assert.ok(!JSON.stringify(st).includes(TOKEN));
  const opened = await ctx.vault.unlock(PIN);
  assert.equal(opened.ok, true);
  assert.equal(opened.token, TOKEN);
  ctx.done();
});

test('neither the PIN nor the token is stored readable, on disk or inside the sealed record', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const disk = readFileSync(ctx.file, 'utf8');
  for (const secret of [PIN, TOKEN, 'priya@example.com']) assert.ok(!disk.includes(secret), `file must not contain ${secret}`);
  const inner = JSON.stringify(readRecord(ctx.file));
  assert.ok(!inner.includes(PIN), 'no PIN inside the record');
  assert.ok(!inner.includes(TOKEN), 'token is encrypted again inside the record');
  ctx.done();
});

test('each PIN setup uses a new salt, so the same PIN never gives the same verifier', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const first = readRecord(ctx.file);
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const second = readRecord(ctx.file);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.verifier, second.verifier);
  ctx.done();
});

test('the production KDF cost is at least 128 MB', () => {
  const { DEFAULT_KDF } = require('../electron/auth-vault.cjs');
  assert.ok(128 * DEFAULT_KDF.N * DEFAULT_KDF.r >= 128 * 1024 * 1024);
});

test('a wrong PIN is denied and each one makes the next try wait longer', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
    const r = await ctx.vault.unlock('000001');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'wrong_pin');
    assert.equal(r.token, undefined);
    assert.equal(r.retryAfterMs, DELAYS_MS[i]);
    assert.equal(r.attemptsLeft, MAX_ATTEMPTS - 1 - i);
    ctx.clock.t += r.retryAfterMs;
  }
  ctx.done();
});

test('during the wait even the correct PIN is refused, and refusing costs no attempt', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const first = await ctx.vault.unlock('000001');
  const during = await ctx.vault.unlock(PIN);
  assert.equal(during.code, 'wait');
  assert.equal(during.attemptsLeft, first.attemptsLeft);
  ctx.clock.t += first.retryAfterMs;
  assert.equal((await ctx.vault.unlock(PIN)).ok, true);
  ctx.done();
});

test('five wrong PINs lock sign-in; the correct PIN is refused until the lock ends, then works', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  let last: any;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) last = await failOnce(ctx);
  assert.equal(last.code, 'locked');
  // failOnce moved the clock to the very end of the lock; rewind for the check below
  ctx.clock.t -= 1000;
  assert.equal((await ctx.vault.unlock(PIN)).code, 'locked');
  assert.equal((await ctx.vault.status()).locked, true);
  ctx.clock.t += 1000;
  assert.equal((await ctx.vault.unlock(PIN)).ok, true);
  ctx.done();
});

test('repeated locks get longer', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  for (const expected of LOCKOUTS_MS.slice(0, 3)) {
    let last: any;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) last = await failOnce(ctx);
    assert.equal(last.code, 'locked');
    assert.equal(last.retryAfterMs, expected);
  }
  ctx.done();
});

test('a correct PIN clears the attempts', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  await failOnce(ctx);
  await failOnce(ctx);
  assert.equal((await ctx.vault.unlock(PIN)).ok, true);
  const r = await ctx.vault.unlock('000001');
  assert.equal(r.attemptsLeft, MAX_ATTEMPTS - 1);
  ctx.done();
});

test(`after ${MAX_TOTAL_FAILURES} wrong PINs in total the saved session is destroyed`, async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  let last: any;
  for (let i = 0; i < MAX_TOTAL_FAILURES; i += 1) last = await failOnce(ctx);
  assert.equal(last.code, 'wiped');
  assert.equal(existsSync(ctx.file), false);
  assert.equal((await ctx.vault.status()).state, 'none');
  ctx.done();
});

test('the attempt is written down before the PIN is checked, so killing the app gives no free guess', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  ctx.sealedTexts.length = 0;
  await ctx.vault.unlock(PIN); // even the correct PIN
  assert.equal(JSON.parse(ctx.sealedTexts[0]).failures, 1, 'first write counts the attempt');
  assert.equal(JSON.parse(ctx.sealedTexts.at(-1)!).failures, 0, 'last write clears it after success');
  ctx.done();
});

test('a fifth attempt that was counted but interrupted still earns the lock', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  writeRecord(ctx.file, { ...readRecord(ctx.file), failures: MAX_ATTEMPTS });
  assert.equal((await ctx.vault.unlock(PIN)).code, 'locked');
  ctx.done();
});

test('restarting the app does not reset attempts or locks', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) await failOnce(ctx);
  const restarted = createAuthVault({ file: ctx.file, isAvailable: () => true, seal, unseal, now: () => ctx.clock.t, kdf: { N: 2 ** 10, r: 8, p: 1 } });
  assert.equal((await restarted.status()).attemptsLeft, 1);
  assert.equal((await restarted.unlock('000001')).code, 'locked');
  ctx.done();
});

test('moving the clock backwards does not shorten a lock', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) await failOnce(ctx);
  const locked = await ctx.vault.unlock('000001');
  ctx.clock.t -= 24 * 60 * 60 * 1000; // a day back
  const after = await ctx.vault.unlock(PIN);
  assert.equal(after.code, 'locked');
  assert.equal(after.retryAfterMs, locked.retryAfterMs);
  ctx.done();
});

test('many tries at the same moment are handled one by one and each is counted', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const results = await Promise.all(Array.from({ length: 10 }, () => ctx.vault.unlock('000001')));
  assert.equal(results.filter((r: any) => r.code === 'wrong_pin').length, 1);
  assert.equal(results.filter((r: any) => r.code === 'wait').length, 9);
  assert.equal(readRecord(ctx.file).failures, 1);
  ctx.done();
});

test('input of the wrong shape is refused without being treated as a guess', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  for (const bad of ['1234', '4829166', 'abcdef', '', null, undefined, 482916, { pin: PIN }]) {
    assert.equal((await ctx.vault.unlock(bad)).code, 'invalid_pin');
  }
  assert.equal(readRecord(ctx.file).failures, 0);
  ctx.done();
});

test('a new PIN replaces the old one and clears any lock', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) await ctx.vault.unlock('000001').then((r: any) => (ctx.clock.t += r.code === 'locked' ? 0 : r.retryAfterMs));
  assert.equal((await ctx.vault.status()).locked, true);
  await ctx.vault.setup({ pin: '7391', token: 'rotated-token-value', account: ACCOUNT });
  assert.equal((await ctx.vault.status()).locked, false);
  assert.equal((await ctx.vault.unlock(PIN)).code, 'invalid_pin', 'old PIN is not even the right length now');
  const opened = await ctx.vault.unlock('7391');
  assert.equal(opened.token, 'rotated-token-value');
  ctx.done();
});

test('setup refuses bad PINs and bad sessions without touching what is saved', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const before = readFileSync(ctx.file, 'utf8');
  assert.equal((await ctx.vault.setup({ pin: '12345', token: TOKEN, account: ACCOUNT })).code, 'invalid_pin');
  assert.equal((await ctx.vault.setup({ pin: '1234', token: TOKEN, account: ACCOUNT })).code, 'weak_pin');
  assert.equal((await ctx.vault.setup({ pin: '7391', token: '', account: ACCOUNT })).code, 'invalid_session');
  assert.equal((await ctx.vault.setup({ pin: '7391', token: TOKEN, account: { email: 'x@y.z' } })).code, 'invalid_session');
  assert.equal((await ctx.vault.setup()).code, 'invalid_pin');
  assert.equal(readFileSync(ctx.file, 'utf8'), before);
  ctx.done();
});

test('a damaged or edited file is removed and reported once, so the user can sign in with the password', async () => {
  const damage: Array<(file: string) => void> = [
    (f) => writeFileSync(f, 'not json at all'),
    (f) => writeFileSync(f, JSON.stringify({ v: 1, sealed: 'AAAA' })),
    (f) => {
      const outer = JSON.parse(readFileSync(f, 'utf8'));
      const data = Buffer.from(outer.sealed, 'base64');
      data[data.length - 1] ^= 1;
      writeFileSync(f, JSON.stringify({ ...outer, sealed: data.toString('base64') }));
    },
    (f) => writeRecord(f, { ...readRecord(f), failures: -1 }),
    (f) => writeRecord(f, { ...readRecord(f), verifier: undefined }),
    (f) => writeRecord(f, { hello: 'world' }),
  ];
  for (const breakIt of damage) {
    const ctx = makeVault();
    await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
    breakIt(ctx.file);
    assert.deepEqual(await ctx.vault.status(), { state: 'corrupt' });
    assert.equal(existsSync(ctx.file), false);
    assert.deepEqual(await ctx.vault.status(), { state: 'none' });
    ctx.done();
  }
});

test('a record whose token fails its integrity check never returns data', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const record = readRecord(ctx.file);
  writeRecord(ctx.file, { ...record, ct: (record.ct[0] === 'a' ? 'b' : 'a') + record.ct.slice(1) });
  const r = await ctx.vault.unlock(PIN);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'corrupt');
  assert.equal(r.token, undefined);
  assert.equal(existsSync(ctx.file), false);
  ctx.done();
});

test('a token moved to another account in the record does not open', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const record = readRecord(ctx.file);
  writeRecord(ctx.file, { ...record, account: { ...record.account, id: 8 } });
  assert.equal((await ctx.vault.unlock(PIN)).code, 'corrupt');
  ctx.done();
});

test('when Windows cannot protect secrets, nothing is saved and an existing record is kept', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const off = createAuthVault({ file: ctx.file, isAvailable: () => false, seal, unseal, kdf: { N: 2 ** 10, r: 8, p: 1 } });
  assert.deepEqual(await off.status(), { state: 'unavailable' });
  assert.equal((await off.unlock(PIN)).code, 'unavailable');
  assert.equal((await off.setup({ pin: '7391', token: TOKEN, account: ACCOUNT })).code, 'unavailable');
  assert.equal(existsSync(ctx.file), true);
  assert.equal((await ctx.vault.unlock(PIN)).ok, true, 'works again once Windows offers protection');
  ctx.done();
});

test('clear removes everything', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  await ctx.vault.clear();
  assert.equal(existsSync(ctx.file), false);
  assert.deepEqual(await ctx.vault.status(), { state: 'none' });
  await ctx.vault.clear(); // twice is fine
  ctx.done();
});

test('the log never receives a PIN, token or verifier', async () => {
  const ctx = makeVault();
  await ctx.vault.setup({ pin: PIN, token: TOKEN, account: ACCOUNT });
  const { verifier } = readRecord(ctx.file);
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) await failOnce(ctx);
  await ctx.vault.unlock(PIN);
  writeFileSync(ctx.file, 'garbage');
  await ctx.vault.status();
  assert.ok(ctx.logs.length > 3, 'events were logged');
  const all = ctx.logs.join('\n');
  for (const secret of [PIN, '000001', TOKEN, verifier]) assert.ok(!all.includes(secret));
  ctx.done();
});

test('weak and malformed PINs: the screen and the main process agree on every 4-digit PIN', () => {
  for (const weak of ['0000', '1111', '1234', '4321', '9012', '111111', '123456', '654321', '890123']) {
    assert.equal(checkNewPin(weak), 'weak', weak);
  }
  for (const bad of ['', '123', '12345', '1234567', 'abcd', '12a4', ' 1234']) assert.equal(checkNewPin(bad), 'format', bad);
  for (const good of ['7391', '482916', '1235', '121212']) assert.equal(checkNewPin(good), null, good);
  for (let i = 0; i < 10000; i += 1) {
    const pin = String(i).padStart(4, '0');
    assert.equal(rendererCheck(pin), checkNewPin(pin), pin);
  }
  for (const pin of ['111111', '123456', '654321', '482916', '12345', 'abcdef', '']) assert.equal(rendererCheck(pin), checkNewPin(pin), pin);
});
