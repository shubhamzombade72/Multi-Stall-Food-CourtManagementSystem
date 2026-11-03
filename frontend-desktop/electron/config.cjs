/**
 * Pure helpers shared by the Electron main process and its unit tests (no Electron imports here).
 */

/** Only plain http(s) URLs ending in /api, without embedded credentials, are accepted as the backend address. */
function normalizeApiUrl(input) {
  if (typeof input !== 'string' || input.length > 300) return null;
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return null;
  const pathname = u.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/api')) return null;
  return `${u.protocol}//${u.host}${pathname}`;
}

function isLoopbackHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h) || h === '0.0.0.0';
}

function isPrivateLanHost(hostname) {
  const h = String(hostname).toLowerCase();
  return (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    !h.includes('.') // single-label LAN names such as "foodcourt-server"
  );
}

/**
 * Non-blocking advice about an address that passed normalizeApiUrl. The operator may still save it
 * (a counter PC that really hosts the API locally is legitimate) but is told about the risk.
 */
function describeApiUrlWarnings(normalized) {
  const warnings = [];
  const u = new URL(normalized);
  if (isLoopbackHost(u.hostname)) {
    warnings.push('This address points to THIS computer. It only works if the Food Court server software is installed and running on this same PC. For a server elsewhere, use that server\'s address.');
  } else if (u.protocol === 'http:' && !isPrivateLanHost(u.hostname)) {
    warnings.push('This is an unencrypted http:// address on a public host. Passwords and sales data would cross the internet in clear text. Use https://.');
  }
  return warnings;
}

/**
 * Turns a low-level connection failure into a stable category plus an operator-readable message.
 * Input is the Chromium net error text ("net::ERR_NAME_NOT_RESOLVED") or a Node error code.
 */
function classifyNetworkError(raw) {
  const text = String(raw || '');
  const has = (re) => re.test(text);
  if (has(/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ERR_NAME_RESOLUTION_FAILED/)) {
    return { code: 'dns', message: 'The server name could not be found (DNS lookup failed). Check the address for typos and that this PC has internet or LAN access.' };
  }
  if (has(/CERT|SSL|TLS|ERR_SSL_|DEPTH_ZERO|UNABLE_TO_VERIFY/i)) {
    return { code: 'ssl', message: 'The server\'s security certificate was rejected (invalid, expired, self-signed, or issued for a different name). Fix the server certificate, or check that this PC\'s date and time are correct.' };
  }
  if (has(/ERR_CONNECTION_REFUSED|ECONNREFUSED/)) {
    return { code: 'refused', message: 'The server computer refused the connection. The API service is not running at this address/port, or a firewall is blocking it.' };
  }
  if (has(/ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|ERR_TIMED_OUT|timeout|timed out/i)) {
    return { code: 'timeout', message: 'The server did not respond in time. It may be offline, or a firewall/network is dropping the traffic.' };
  }
  if (has(/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENETUNREACH|EHOSTUNREACH|ERR_ADDRESS_UNREACHABLE/)) {
    return { code: 'network', message: 'This computer has no network route to the server. Check the network connection.' };
  }
  return { code: 'unreachable', message: 'The server could not be reached.' };
}

/** Classification of an HTTP answer to GET <api>/auth/me without a token (a healthy Laravel API answers 401). */
function classifyApiProbe(status) {
  if (status === 401) return { ok: true, code: 'api_ok', message: 'Food Court API found and responding.' };
  if (status === 404) return { ok: false, code: 'wrong_path', message: 'A server answered, but it is not the Food Court API at this address (404). Check the address path ends in /api.' };
  if (status >= 500) return { ok: false, code: 'server_error', message: `The API server reported an internal error (HTTP ${status}). Check the Laravel logs on the server.` };
  if (status === 403) return { ok: false, code: 'forbidden', message: 'The server refused access (HTTP 403). A firewall or proxy may be blocking this PC.' };
  return { ok: false, code: 'unexpected', message: `Unexpected answer from the server (HTTP ${status}).` };
}

/** `electron/app-config.json` is the release engineer's explicit production setting; empty means "not set". */
function parseBundledConfig(text) {
  try {
    const parsed = JSON.parse(text);
    return normalizeApiUrl(parsed && parsed.apiBaseUrl);
  } catch {
    return null;
  }
}

/**
 * Whether an address saved in config.json should still be used. Addresses typed by hand in 1.0.x on "this
 * computer" (127.0.0.1 / localhost) pointed at servers that were never installed; without a pairing they are
 * ignored so the PC falls back to its own built-in database instead of a permanent "cannot reach" screen.
 */
function shouldUseSavedAddress(url, paired) {
  const normalized = normalizeApiUrl(url);
  if (!normalized) return false;
  return paired || !isLoopbackHost(new URL(normalized).hostname);
}

module.exports = { shouldUseSavedAddress, normalizeApiUrl, isLoopbackHost, isPrivateLanHost, describeApiUrlWarnings, classifyNetworkError, classifyApiProbe, parseBundledConfig };
