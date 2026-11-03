/**
 * Desktop unit tests: kitchen display logic, CSV export safety and the Electron API-URL validator.
 * Run with `pnpm test` (Node's built-in runner with TypeScript type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { columnFor, elapsed, newTicketIds, nextKitchenAction, urgency } from '../src/lib/kds.ts';
import { csvCell, toCsv } from '../src/lib/csv.ts';
import { describeLoginError, API_NOT_CONFIGURED } from '../src/lib/apiErrors.ts';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { normalizeApiUrl, describeApiUrlWarnings, classifyNetworkError, classifyApiProbe, parseBundledConfig, isLoopbackHost } = require('../electron/config.cjs');

// ---------------------------------------------------------------- kitchen display
test('KDS actions follow the backend forward-only state machine', () => {
  assert.deepEqual(nextKitchenAction('pending'), { label: 'Accept', to: 'accepted' });
  assert.deepEqual(nextKitchenAction('accepted'), { label: 'Start Preparing', to: 'preparing' });
  assert.deepEqual(nextKitchenAction('preparing'), { label: 'Mark Ready', to: 'ready' });
  assert.equal(nextKitchenAction('ready'), null, 'serving is not a kitchen action');
  assert.equal(nextKitchenAction('picked_up'), null);
  assert.equal(nextKitchenAction('cancelled'), null);
});

test('KDS columns group statuses', () => {
  assert.equal(columnFor('pending'), 'new');
  assert.equal(columnFor('accepted'), 'new');
  assert.equal(columnFor('preparing'), 'preparing');
  assert.equal(columnFor('ready'), 'ready');
  assert.equal(columnFor('picked_up'), 'served');
  assert.equal(columnFor('cancelled'), null);
});

test('KDS urgency and timers', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(urgency('2026-11-02T11:50:00Z', now), 'normal');
  assert.equal(urgency('2026-11-02T11:45:00Z', now), 'warning');
  assert.equal(urgency('2026-11-02T11:30:00Z', now), 'late');
  assert.equal(elapsed('2026-11-02T11:58:05Z', now), '1:55');
  assert.equal(elapsed('2026-11-02T10:30:00Z', now), '1h 30m');
  assert.deepEqual(newTicketIds(new Set([1, 2]), [1, 2, 3, 4]), [3, 4]);
  assert.deepEqual(newTicketIds(new Set([1, 2]), [2]), []);
});

// ---------------------------------------------------------------- CSV export
test('CSV quotes separators and neutralises spreadsheet formulas', () => {
  assert.equal(csvCell('Pizza, Large'), '"Pizza, Large"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell('+1+1'), "'+1+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-12.50'), '-12.50', 'negative numbers stay numeric');
  assert.equal(csvCell(null), '');
  const csv = toCsv([{ a: 'x', b: 2 }], [{ header: 'A', value: (r) => r.a }, { header: 'B', value: (r) => r.b }]);
  assert.equal(csv, 'A,B\r\nx,2');
});

// ---------------------------------------------------------------- Electron config validation
test('API base URL must be a plain http(s) URL ending in /api', () => {
  assert.equal(normalizeApiUrl('http://192.168.1.50:8000/api'), 'http://192.168.1.50:8000/api');
  assert.equal(normalizeApiUrl('  https://pos.local/api/  '), 'https://pos.local/api');
  assert.equal(normalizeApiUrl('http://192.168.1.50:8000'), null, 'must end in /api');
  assert.equal(normalizeApiUrl('file:///C:/Windows/api'), null);
  assert.equal(normalizeApiUrl('javascript:alert(1)//api'), null);
  assert.equal(normalizeApiUrl('http://user:pass@host/api'), null, 'no embedded credentials');
  assert.equal(normalizeApiUrl('http://host/api?x=1'), null);
  assert.equal(normalizeApiUrl(42), null);
  assert.equal(normalizeApiUrl('x'.repeat(400)), null);
});

// ---------------------------------------------------------------- production API configuration
test('packaged app has no built-in loopback / localhost API default', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /DEFAULT_API_BASE_URL/, 'the silent default address was removed');
  const codeOnly = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ e\.g\..*$/gm, '');
  assert.doesNotMatch(codeOnly, /https?:\/\/(127\.0\.0\.1|localhost)/, 'no loopback http URL literal in the main process');
});

test('bundled release config is empty or a valid non-loopback production URL', () => {
  const text = readFileSync(new URL('../electron/app-config.json', import.meta.url), 'utf8');
  const cfg = JSON.parse(text);
  if (cfg.apiBaseUrl) {
    const normalized = parseBundledConfig(text);
    assert.ok(normalized, 'apiBaseUrl must pass validation');
    assert.equal(isLoopbackHost(new URL(normalized).hostname), false, 'a shipped installer must not point at loopback');
    assert.equal(new URL(normalized).protocol, 'https:', 'production address must use https');
  } else {
    assert.equal(parseBundledConfig(text), null, 'empty means unconfigured: the Server Setup screen is shown');
  }
});

test('bundled config parser rejects junk', () => {
  assert.equal(parseBundledConfig('{"apiBaseUrl":"http://x/y"}'), null);
  assert.equal(parseBundledConfig('not json'), null);
  assert.equal(parseBundledConfig('{"apiBaseUrl":"https://api.example.com/api"}'), 'https://api.example.com/api');
});

test('URL warnings: loopback and plain http on a public host are flagged, LAN and https are not', () => {
  assert.equal(describeApiUrlWarnings('http://127.0.0.1:8000/api').length, 1);
  assert.equal(describeApiUrlWarnings('http://localhost/api').length, 1);
  assert.equal(describeApiUrlWarnings('http://203.0.113.9/api').length, 1);
  assert.equal(describeApiUrlWarnings('http://192.168.1.50:8000/api').length, 0);
  assert.equal(describeApiUrlWarnings('http://foodcourt-server:8000/api').length, 0);
  assert.equal(describeApiUrlWarnings('https://api.example.com/api').length, 0);
});

test('connection failures are classified for the operator', () => {
  assert.equal(classifyNetworkError('net::ERR_NAME_NOT_RESOLVED').code, 'dns');
  assert.equal(classifyNetworkError('getaddrinfo ENOTFOUND api.example.com').code, 'dns');
  assert.equal(classifyNetworkError('net::ERR_CERT_AUTHORITY_INVALID').code, 'ssl');
  assert.equal(classifyNetworkError('net::ERR_CERT_DATE_INVALID').code, 'ssl');
  assert.equal(classifyNetworkError('net::ERR_SSL_PROTOCOL_ERROR').code, 'ssl');
  assert.equal(classifyNetworkError('net::ERR_CONNECTION_REFUSED').code, 'refused');
  assert.equal(classifyNetworkError('net::ERR_CONNECTION_TIMED_OUT').code, 'timeout');
  assert.equal(classifyNetworkError('timeout').code, 'timeout');
  assert.equal(classifyNetworkError('net::ERR_INTERNET_DISCONNECTED').code, 'network');
  assert.equal(classifyNetworkError('something odd').code, 'unreachable');
});

test('API probe answers: 401 = healthy API, others are diagnosed', () => {
  assert.equal(classifyApiProbe(401).ok, true);
  assert.equal(classifyApiProbe(404).code, 'wrong_path');
  assert.equal(classifyApiProbe(500).code, 'server_error');
  assert.equal(classifyApiProbe(503).code, 'server_error');
  assert.equal(classifyApiProbe(403).code, 'forbidden');
  assert.equal(classifyApiProbe(200).ok, false, 'a 200 without a token is not the Food Court API');
});

test('sign-in errors map to actionable messages', () => {
  assert.equal(describeLoginError({ code: API_NOT_CONFIGURED }).kind, 'not_configured');
  assert.equal(describeLoginError({ message: 'Network Error' }).kind, 'unreachable');
  assert.equal(describeLoginError({ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' }).kind, 'timeout');
  const invalid = describeLoginError({ response: { status: 422, data: { message: 'x', errors: { email: ['The provided credentials do not match our records.'] } } } });
  assert.equal(invalid.kind, 'invalid_credentials');
  assert.equal(invalid.message, 'Invalid email or password.');
  assert.equal(describeLoginError({ response: { status: 401, data: {} } }).kind, 'unauthorized');
  assert.equal(describeLoginError({ response: { status: 403, data: { message: 'Your account has been deactivated.' } } }).message, 'Your account has been deactivated.');
  assert.equal(describeLoginError({ response: { status: 429, data: {} } }).kind, 'rate_limited');
  assert.equal(describeLoginError({ response: { status: 404, data: {} } }).kind, 'wrong_path');
  assert.equal(describeLoginError({ response: { status: 500, data: {} } }).kind, 'server_error');
});
