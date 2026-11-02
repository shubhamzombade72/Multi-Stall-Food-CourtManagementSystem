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

module.exports = { normalizeApiUrl };
