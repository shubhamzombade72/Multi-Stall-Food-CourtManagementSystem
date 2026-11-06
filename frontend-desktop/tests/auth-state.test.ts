/**
 * The sign-in state machine, where the renderer keeps its token, and the wiring that must not drift: the bridge
 * channels, the "PIN off" test switch, and which code may touch stored tokens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { authReducer, canShowApp, type AuthEvent, type AuthStatus } from '../src/lib/authMachine.ts';
import { clearAuthToken, getAuthToken, LEGACY_TOKEN_KEY, LEGACY_USER_KEY, setAuthToken, setTokenMode } from '../src/lib/authToken.ts';
import { formatWait } from '../src/lib/pin.ts';

const run = (start: AuthStatus, ...events: AuthEvent[]) => events.reduce(authReducer, start);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const ALL_STATES: AuthStatus[] = ['INITIALIZING', 'FIRST_TIME_LOGIN', 'PIN_SETUP', 'PIN_REQUIRED', 'PIN_VERIFICATION', 'AUTHENTICATED', 'SESSION_EXPIRED', 'ACCOUNT_RECOVERY', 'LOGGED_OUT', 'ERROR'];
const ALL_EVENTS: AuthEvent[] = ['BOOT_NO_ACCOUNT', 'BOOT_VAULT_FOUND', 'BOOT_SESSION_NO_PIN', 'BOOT_SESSION_PLAIN', 'LOGIN_NEEDS_PIN', 'LOGIN_NO_PIN', 'PIN_SET', 'PIN_SUBMIT', 'PIN_REJECTED', 'SESSION_VALID', 'SESSION_REJECTED', 'FORGOT_PIN', 'RECOVERY_CANCELLED', 'LOCK', 'LOGOUT', 'FAIL', 'RETRY'];

test('startup decision: no account -> password, account without PIN -> setup, PIN configured -> PIN screen', () => {
  assert.equal(run('INITIALIZING', 'BOOT_NO_ACCOUNT'), 'FIRST_TIME_LOGIN');
  assert.equal(run('INITIALIZING', 'BOOT_SESSION_NO_PIN'), 'PIN_SETUP');
  assert.equal(run('INITIALIZING', 'BOOT_VAULT_FOUND'), 'PIN_REQUIRED');
});

test('first time: password -> create PIN -> app', () => {
  assert.deepEqual(['LOGIN_NEEDS_PIN', 'PIN_SET'].reduce<AuthStatus[]>((seen, e) => [...seen, authReducer(seen.at(-1)!, e as AuthEvent)], ['FIRST_TIME_LOGIN']), ['FIRST_TIME_LOGIN', 'PIN_SETUP', 'AUTHENTICATED']);
});

test('every next time: PIN -> server accepts the session -> app', () => {
  assert.equal(run('PIN_REQUIRED', 'PIN_SUBMIT'), 'PIN_VERIFICATION');
  assert.equal(run('PIN_REQUIRED', 'PIN_SUBMIT', 'SESSION_VALID'), 'AUTHENTICATED');
});

test('forgot PIN: password -> new PIN -> app; backing out returns to the PIN screen', () => {
  assert.equal(run('PIN_REQUIRED', 'FORGOT_PIN'), 'ACCOUNT_RECOVERY');
  assert.equal(run('PIN_REQUIRED', 'FORGOT_PIN', 'LOGIN_NEEDS_PIN', 'PIN_SET'), 'AUTHENTICATED');
  assert.equal(run('PIN_REQUIRED', 'FORGOT_PIN', 'RECOVERY_CANCELLED'), 'PIN_REQUIRED');
});

test('lock returns to the PIN screen; full logout returns to the password screen', () => {
  assert.equal(run('AUTHENTICATED', 'LOCK'), 'PIN_REQUIRED');
  assert.equal(run('AUTHENTICATED', 'LOGOUT'), 'LOGGED_OUT');
});

test('a correct PIN is not enough: a refused session needs the password, an unreachable server is an error', () => {
  assert.equal(run('PIN_VERIFICATION', 'SESSION_REJECTED'), 'SESSION_EXPIRED');
  assert.equal(run('PIN_VERIFICATION', 'SESSION_REJECTED', 'LOGIN_NEEDS_PIN'), 'PIN_SETUP');
  assert.equal(run('PIN_VERIFICATION', 'FAIL'), 'ERROR');
  assert.equal(run('PIN_VERIFICATION', 'FAIL', 'RETRY'), 'INITIALIZING');
});

test('the app opens only through a password + new PIN, a server-accepted session, or a build without PINs', () => {
  const ways: string[] = [];
  for (const from of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (from !== 'AUTHENTICATED' && authReducer(from, event) === 'AUTHENTICATED') ways.push(`${from}+${event}`);
    }
  }
  assert.deepEqual(ways.sort(), [
    'ACCOUNT_RECOVERY+LOGIN_NO_PIN',
    'FIRST_TIME_LOGIN+LOGIN_NO_PIN',
    'INITIALIZING+BOOT_SESSION_PLAIN',
    'LOGGED_OUT+LOGIN_NO_PIN',
    'PIN_SETUP+LOGIN_NO_PIN',
    'PIN_SETUP+PIN_SET',
    'PIN_VERIFICATION+SESSION_VALID',
    'SESSION_EXPIRED+LOGIN_NO_PIN',
  ]);
  assert.deepEqual(ALL_STATES.filter(canShowApp), ['AUTHENTICATED']);
});

test('the PIN screen cannot skip verification, and a late event cannot move a locked or signed-out app', () => {
  assert.equal(run('PIN_REQUIRED', 'SESSION_VALID'), 'PIN_REQUIRED');
  assert.equal(run('PIN_REQUIRED', 'PIN_SET'), 'PIN_REQUIRED');
  assert.equal(run('PIN_REQUIRED', 'LOGIN_NEEDS_PIN'), 'PIN_REQUIRED');
  assert.equal(run('LOGGED_OUT', 'SESSION_VALID'), 'LOGGED_OUT');
  assert.equal(run('LOGGED_OUT', 'SESSION_REJECTED'), 'LOGGED_OUT');
  assert.equal(run('FIRST_TIME_LOGIN', 'SESSION_REJECTED'), 'FIRST_TIME_LOGIN');
  assert.equal(run('ERROR', 'SESSION_VALID'), 'ERROR');
});

test('every state has a way forward', () => {
  for (const state of ALL_STATES) {
    assert.ok(ALL_EVENTS.some((e) => authReducer(state, e) !== state), `${state} is a dead end`);
  }
});

// ---------------------------------------------------------------- token storage
const fakeLocalStorage = () => {
  const data = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
};

test('desktop keeps the token in memory only, and removes what an older version left behind', () => {
  const data = fakeLocalStorage();
  data.set(LEGACY_TOKEN_KEY, 'old');
  data.set(LEGACY_USER_KEY, '{}');
  setTokenMode('memory');
  assert.equal(getAuthToken(), null, 'memory mode never reads localStorage');
  setAuthToken('secret');
  assert.equal(getAuthToken(), 'secret');
  assert.equal(data.get(LEGACY_TOKEN_KEY), 'old', 'and never writes it');
  clearAuthToken();
  assert.equal(getAuthToken(), null);
  assert.equal(data.size, 0);
});

test('the web build keeps using localStorage as before', () => {
  const data = fakeLocalStorage();
  setTokenMode('local');
  setAuthToken('web');
  assert.equal(data.get(LEGACY_TOKEN_KEY), 'web');
  assert.equal(getAuthToken(), 'web');
  clearAuthToken();
  assert.equal(getAuthToken(), null);
  setTokenMode('memory');
});

test('lock countdown wording', () => {
  assert.equal(formatWait(1), '1 second');
  assert.equal(formatWait(8000), '8 seconds');
  assert.equal(formatWait(300000), '5 minutes 00 seconds');
  assert.equal(formatWait(61000), '1 minute 01 seconds');
});

// ---------------------------------------------------------------- wiring
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

test('only the token module and the upgrade path read or write the stored token', () => {
  const src = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const offenders = walk(decodeURIComponent(src))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /localStorage\.(getItem|setItem)\(\s*['"]fc_auth/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('every sign-in channel the preload calls is registered in the main process', () => {
  const preload = read('../electron/preload.cjs');
  const main = read('../electron/main.cjs');
  const channels = [...preload.matchAll(/'(auth:[a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(channels.sort(), ['auth:clear', 'auth:setup', 'auth:status', 'auth:unlock']);
  for (const channel of channels) assert.ok(main.includes(`handle('${channel}'`), channel);
});

test('the PIN-off test switch cannot work in an installed app', () => {
  assert.match(read('../electron/main.cjs'), /!app\.isPackaged && process\.env\.FOODCOURT_PIN_LOCK === 'off'/);
});

test('changing which data this PC uses forgets the saved sign-in', () => {
  const main = read('../electron/main.cjs');
  assert.equal([...main.matchAll(/await forgetSavedSignIn\(\)/g)].length, 3, 'pair, leave host, restore backup that does not fit');
  assert.match(main, /if \(!kept\) await forgetSavedSignIn\(\)/, 'a restore keeps the PIN only when the session was carried over');
});

test('a restore keeps the PIN only when the API confirms the session was carried over', async () => {
  const backup = (await import('../electron/backup.cjs')).default as any;
  const account = { id: 1, email: 'o@example.com', role: 'owner', name: 'O' };
  const log = () => undefined;
  const answering = (line: string) => async () => line;

  assert.equal(await backup.keepSession({ artisan: answering('{"ok":true,"kept":true,"reason":null}'), previous: 'p', account, log }), true);
  assert.equal(await backup.keepSession({ artisan: answering('{"ok":true,"kept":false,"reason":"role_changed"}'), previous: 'p', account, log }), false);
  assert.equal(await backup.keepSession({ artisan: answering('not json'), previous: 'p', account, log }), false);
  assert.equal(await backup.keepSession({ artisan: async () => { throw new Error('php failed'); }, previous: 'p', account, log }), false);
  assert.equal(await backup.keepSession({ artisan: answering('{"kept":true}'), previous: 'p', account: null, log }), false, 'no saved sign-in, nothing to keep');
});

test('no route exists behind the PIN screen, and the forgot-password link has a route', () => {
  const app = read('../src/App.tsx');
  assert.match(app, /case 'PIN_REQUIRED':\s*case 'PIN_VERIFICATION':\s*return <PinLoginPage \/>/);
  assert.match(app, /<AuthGate>\s*<Routes>/);
  assert.match(app, /path="\/recover" element/);
});
