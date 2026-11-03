/**
 * Multi-PC pairing helpers (no Electron imports). The owner of the shared host creates a connection code;
 * it reaches this PC as an opaque "FCPAIR1.…" string that carries the host address and a one-time code, so
 * nobody types an address. Pure functions only; the network call and token storage live in main.cjs.
 */
const { normalizeApiUrl, isLoopbackHost, isPrivateLanHost } = require('./config.cjs');

const PREFIX = 'FCPAIR1.';

/** Decodes and validates what the owner handed over. Never throws. */
function decodePairingString(input) {
  const text = String(input || '').trim().replace(/\s+/g, '');
  if (!text.startsWith(PREFIX) || text.length > 600) return { ok: false, error: 'This is not a valid connection code. Ask the owner to show it again.' };
  let payload;
  try {
    const b64 = text.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return { ok: false, error: 'This is not a valid connection code. Ask the owner to show it again.' };
  }
  const url = normalizeApiUrl(payload && payload.u);
  const code = String((payload && payload.c) || '').toUpperCase();
  if (!url || !/^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(code)) return { ok: false, error: 'This connection code is damaged. Ask the owner to show it again.' };
  return { ok: true, url, code };
}

/**
 * Passwords and sales data must not cross the internet unencrypted: plain http is accepted only to this
 * PC or a private network. A public host must use https.
 */
function hostIsSafe(apiUrl) {
  const u = new URL(apiUrl);
  if (u.protocol === 'https:') return { ok: true };
  if (isLoopbackHost(u.hostname) || isPrivateLanHost(u.hostname)) return { ok: true, lan: true };
  return { ok: false, error: 'The host is on the internet but not using a secure (https) connection. Ask your administrator to enable https.' };
}

/** Maps the host's answer to redeeming a code to wording the staff can act on. */
function describeRedeemFailure(status) {
  if (status === 422) return 'The connection code is wrong or has expired. Ask the owner for a new one (they last 15 minutes and work once).';
  if (status === 404) return 'That computer is not a shared Food Court host. Check with your administrator.';
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  return `The host did not accept the code (HTTP ${status}).`;
}

/** Only a header for the paired host's own origin is ever added to a request. */
function shouldAttachDeviceToken(requestUrl, apiBaseUrl) {
  try {
    return new URL(requestUrl).origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}

module.exports = { PREFIX, decodePairingString, hostIsSafe, describeRedeemFailure, shouldAttachDeviceToken };
