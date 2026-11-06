/**
 * Device sign-in vault: keeps this PC's API session behind a PIN. Runs in the main process only, so the renderer
 * cannot read the verifier, skip the delays or reset the attempt counter.
 *
 * Layers (see docs/desktop/pin-login.md for what each does and does not protect against):
 *  1. The whole record is sealed by the OS (safeStorage = Windows DPAPI, bound to this Windows account). A record
 *     that was edited, copied from another account or damaged does not unseal, and is treated as corrupt.
 *  2. The API token is additionally AES-256-GCM encrypted under a key derived from the PIN (scrypt with a unique
 *     salt), so unsealing the record is not enough to get the token.
 *  3. Attempts are counted BEFORE the PIN is checked, so killing the app mid-check does not earn a free try.
 *
 * A PIN proves only that the person at this PC knows it. It says nothing about the server session: the caller must
 * still validate the released token with the server.
 *
 * Node's Argon2 is not available in Electron (BoringSSL build: "Argon2 algorithm not supported") and the app ships
 * no node_modules, so the KDF is scrypt. The parameters are stored with each record and can be raised later.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VAULT_VERSION = 1;
const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 }; // about 130 MB and just under a second per guess
const SALT_BYTES = 32;
const KEY_BYTES = 64; // 32 for the verifier, 32 for the token cipher
const VERIFIER_LABEL = 'foodcourt-pin-verifier-v1';

const MAX_ATTEMPTS = 5; // wrong PINs before a temporary lock
const DELAYS_MS = [1000, 2000, 4000, 8000]; // wait after wrong PIN 1, 2, 3, 4
const LOCKOUTS_MS = [5, 15, 30, 60].map((m) => m * 60 * 1000); // first, second, third, later locks
const MAX_TOTAL_FAILURES = 20; // without one success: the saved session is destroyed and the password is required

/** Same rules as src/lib/pin.ts (a test keeps them identical); this one is the authority. */
function checkNewPin(pin) {
  if (typeof pin !== 'string' || !/^(\d{4}|\d{6})$/.test(pin)) return 'format';
  if (/^(\d)\1+$/.test(pin)) return 'weak';
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10));
  if (steps.size === 1 && (steps.has(1) || steps.has(9))) return 'weak';
  return null;
}

function cleanAccount(account) {
  if (!account || typeof account !== 'object') return null;
  const { id, name, email, role } = account;
  if (!Number.isSafeInteger(id) || typeof email !== 'string' || !email || email.length > 200) return null;
  return { id, name: typeof name === 'string' ? name.slice(0, 200) : '', email, role: typeof role === 'string' ? role.slice(0, 50) : '' };
}

const isHex = (v) => typeof v === 'string' && /^[0-9a-f]+$/.test(v) && v.length % 2 === 0;
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

/** Strict shape check: anything unexpected is treated as corrupt rather than half-trusted. */
function validRecord(r) {
  return Boolean(
    r && r.v === VAULT_VERSION && cleanAccount(r.account) && (r.pinLength === 4 || r.pinLength === 6) &&
      isHex(r.salt) && isHex(r.verifier) && isHex(r.iv) && isHex(r.tag) && isHex(r.ct) &&
      r.kdf && isCount(r.kdf.N) && isCount(r.kdf.r) && isCount(r.kdf.p) &&
      isCount(r.failures) && isCount(r.totalFailures) && isCount(r.lockouts) &&
      isCount(r.lockedUntil) && isCount(r.notBefore) && isCount(r.lastSeen)
  );
}

function deriveKeys(pin, salt, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, KEY_BYTES, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r }, (err, key) => {
      if (err) return reject(err);
      resolve({ verifyKey: key.subarray(0, 32), tokenKey: key.subarray(32, 64) });
    });
  });
}

const verifierOf = (verifyKey) => crypto.createHmac('sha256', verifyKey).update(VERIFIER_LABEL).digest();

/**
 * @param {object} deps
 * @param {string} deps.file where the sealed record lives
 * @param {() => boolean} deps.isAvailable can the OS protect secrets for this account right now?
 * @param {(text: string) => Buffer} deps.seal
 * @param {(data: Buffer) => string} deps.unseal throws when the data cannot be opened
 * @param {(level: string, message: string) => void} [deps.log] never receives a PIN, token or verifier
 * @param {() => number} [deps.now]
 * @param {{N:number,r:number,p:number}} [deps.kdf] tests use a cheaper cost
 */
function createAuthVault({ file, isAvailable, seal, unseal, log = () => undefined, now = Date.now, kdf = DEFAULT_KDF }) {
  // One operation at a time: a double click or a second window cannot race the attempt counter.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const remove = () => fs.rmSync(file, { force: true });

  function save(record) {
    const sealed = seal(JSON.stringify(record));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: VAULT_VERSION, sealed: sealed.toString('base64') }), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file); // atomic: a crash leaves the old record or the new one, never half of one
  }

  /** none | unavailable | corrupt (already removed) | ok. Never throws. */
  function load() {
    if (!fs.existsSync(file)) return { kind: isAvailable() ? 'none' : 'unavailable' };
    // Not the record's fault: keep it, Windows may offer protection again on the next start
    if (!isAvailable()) return { kind: 'unavailable' };
    try {
      const outer = JSON.parse(fs.readFileSync(file, 'utf8'));
      const record = JSON.parse(unseal(Buffer.from(outer.sealed, 'base64')));
      if (!validRecord(record)) throw new Error('unexpected record shape');
      return { kind: 'ok', record };
    } catch {
      log('WARN', 'The saved sign-in on this computer could not be read and was removed; the password is required');
      try {
        remove();
      } catch (err) {
        log('ERROR', `Could not remove the unreadable sign-in file: ${err.code || 'unknown error'}`);
      }
      return { kind: 'corrupt' };
    }
  }

  /**
   * A clock moved backwards must not shorten a wait: keep the time that was still left.
   * An expired lock gives a fresh run of attempts (the total keeps counting).
   */
  function settleClock(record, t) {
    if (t < record.lastSeen) {
      const shift = record.lastSeen - t;
      if (record.lockedUntil) record.lockedUntil = Math.max(0, record.lockedUntil - shift);
      if (record.notBefore) record.notBefore = Math.max(0, record.notBefore - shift);
    }
    record.lastSeen = t;
    if (record.lockedUntil && t >= record.lockedUntil) {
      record.lockedUntil = 0;
      record.failures = 0;
    }
  }

  const publicState = (record, t) => ({
    state: 'ready',
    account: cleanAccount(record.account),
    pinLength: record.pinLength,
    locked: record.lockedUntil > t,
    retryAfterMs: Math.max(record.lockedUntil - t, record.notBefore - t, 0),
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - record.failures),
  });

  const status = () =>
    serial(() => {
      const loaded = load();
      if (loaded.kind !== 'ok') return { state: loaded.kind };
      const t = now();
      const record = { ...loaded.record };
      settleClock(record, t);
      return publicState(record, t);
    });

  const setup = ({ pin, token, account } = {}) =>
    serial(async () => {
      if (!isAvailable()) return { ok: false, code: 'unavailable' };
      const pinProblem = checkNewPin(pin);
      if (pinProblem) return { ok: false, code: pinProblem === 'weak' ? 'weak_pin' : 'invalid_pin' };
      const owner = cleanAccount(account);
      if (!owner || typeof token !== 'string' || token.length < 10 || token.length > 2048) return { ok: false, code: 'invalid_session' };

      const salt = crypto.randomBytes(SALT_BYTES);
      const { verifyKey, tokenKey } = await deriveKeys(pin, salt, kdf);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey, iv);
      cipher.setAAD(Buffer.from(String(owner.id)));
      const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      save({
        v: VAULT_VERSION,
        account: owner,
        pinLength: pin.length,
        kdf: { N: kdf.N, r: kdf.r, p: kdf.p },
        salt: salt.toString('hex'),
        verifier: verifierOf(verifyKey).toString('hex'),
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ct: ct.toString('hex'),
        failures: 0,
        totalFailures: 0,
        lockouts: 0,
        lockedUntil: 0,
        notBefore: 0,
        lastSeen: now(),
      });
      log('INFO', 'A PIN was set for this computer');
      return { ok: true, account: owner, pinLength: pin.length };
    });

  const unlock = (pin) =>
    serial(async () => {
      const loaded = load();
      if (loaded.kind !== 'ok') return { ok: false, code: loaded.kind === 'none' ? 'no_vault' : loaded.kind };
      const record = loaded.record;
      const t = now();
      settleClock(record, t);

      // Interrupted right after a counted fifth attempt: apply the lock it earned
      if (record.failures >= MAX_ATTEMPTS && !record.lockedUntil) applyLock(record, t);
      if (record.lockedUntil > t) {
        save(record);
        return { ok: false, code: 'locked', retryAfterMs: record.lockedUntil - t, attemptsLeft: 0 };
      }
      if (record.notBefore > t) {
        save(record);
        return { ok: false, code: 'wait', retryAfterMs: record.notBefore - t, attemptsLeft: MAX_ATTEMPTS - record.failures };
      }
      // Not a guess at this PIN (the keypad cannot send this), so it costs no attempt
      if (typeof pin !== 'string' || pin.length !== record.pinLength || !/^\d+$/.test(pin)) {
        return { ok: false, code: 'invalid_pin', retryAfterMs: 0, attemptsLeft: MAX_ATTEMPTS - record.failures };
      }

      record.failures += 1;
      record.totalFailures += 1;
      save(record); // counted before checking: a killed process does not get this guess for free

      const { verifyKey, tokenKey } = await deriveKeys(pin, Buffer.from(record.salt, 'hex'), record.kdf);
      const stored = Buffer.from(record.verifier, 'hex');
      const actual = verifierOf(verifyKey);
      const match = stored.length === actual.length && crypto.timingSafeEqual(stored, actual);

      if (!match) {
        log('WARN', `Wrong PIN entered on this computer (${record.totalFailures} since the last success)`);
        if (record.totalFailures >= MAX_TOTAL_FAILURES) {
          remove();
          log('WARN', 'Too many wrong PINs: the saved sign-in was removed; the password is required');
          return { ok: false, code: 'wiped' };
        }
        if (record.failures >= MAX_ATTEMPTS) {
          applyLock(record, t);
          save(record);
          return { ok: false, code: 'locked', retryAfterMs: record.lockedUntil - t, attemptsLeft: 0 };
        }
        record.notBefore = t + DELAYS_MS[record.failures - 1];
        save(record);
        return { ok: false, code: 'wrong_pin', retryAfterMs: record.notBefore - t, attemptsLeft: MAX_ATTEMPTS - record.failures };
      }

      let token;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey, Buffer.from(record.iv, 'hex'));
        decipher.setAAD(Buffer.from(String(record.account.id)));
        decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
        token = Buffer.concat([decipher.update(Buffer.from(record.ct, 'hex')), decipher.final()]).toString('utf8');
      } catch {
        remove();
        log('WARN', 'The saved session failed its integrity check and was removed; the password is required');
        return { ok: false, code: 'corrupt' };
      }

      record.failures = 0;
      record.totalFailures = 0;
      record.lockouts = 0;
      record.lockedUntil = 0;
      record.notBefore = 0;
      save(record);
      return { ok: true, token, account: cleanAccount(record.account) };
    });

  function applyLock(record, t) {
    record.lockedUntil = t + LOCKOUTS_MS[Math.min(record.lockouts, LOCKOUTS_MS.length - 1)];
    record.lockouts += 1;
    record.notBefore = 0;
    log('WARN', 'PIN sign-in was temporarily locked after too many wrong attempts');
  }

  const clear = () =>
    serial(() => {
      remove();
      return { ok: true };
    });

  return { status, setup, unlock, clear };
}

module.exports = { createAuthVault, checkNewPin, MAX_ATTEMPTS, DELAYS_MS, LOCKOUTS_MS, MAX_TOTAL_FAILURES, DEFAULT_KDF };
