/**
 * Which keys may sign updates. One answer for both the update agent and the bootstrapper, so a release can never pass one
 * and fail the other. No Electron imports.
 *
 *   update-trust.json (installed files only)   { "root": { id: publicKey }, "keys": { id: publicKey } }
 *   <updates>/state/trust-statement.json       the newest rotation statement this PC has accepted
 *
 * A rotation statement is signed by a root key, kept offline, and changes the signing keys:
 *   { "version": 2, "keys": { "new-id": "<public key>" }, "retired": ["old-id"], "issued_at": "..." }
 *
 * The root key cannot be changed this way: if it leaks, every client needs a new installer. A statement with a lower
 * version than the accepted one is refused, so an old statement cannot bring back a retired key.
 */
const fs = require('node:fs');
const { readJsonOr, verifySignature, writeJsonDurable } = require('./format.cjs');

const ID = /^[A-Za-z0-9._-]{1,40}$/;

function readInstalled(installedFile) {
  const raw = readJsonOr(installedFile) || {};
  return { root: raw.root && typeof raw.root === 'object' ? raw.root : {}, keys: raw.keys && typeof raw.keys === 'object' ? raw.keys : {} };
}

/** The statement's contents if it is genuine and well formed, otherwise null. */
function readStatement(raw, signature, keyId, root) {
  if (typeof raw !== 'string' || raw.length > 20000) return null;
  if (!verifySignature(raw, signature, keyId, root)) return null;
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Number.isInteger(s?.version) || s.version < 1) return null;
  if (!s.keys || typeof s.keys !== 'object' || !Array.isArray(s.retired)) return null;
  if (!Object.keys(s.keys).every((id) => ID.test(id)) || !s.retired.every((id) => typeof id === 'string')) return null;
  return s;
}

/** Trusted signing keys on this PC right now: installed keys, then the accepted statement's additions and retirements. */
function resolveTrust(installedFile, statementFile) {
  const { root, keys } = readInstalled(installedFile);
  const stored = statementFile ? readJsonOr(statementFile) : null;
  if (!stored) return { ...keys };
  const statement = readStatement(stored.raw, stored.signature, stored.key_id, root);
  if (!statement) return { ...keys }; // a damaged or forged file changes nothing
  const resolved = { ...keys, ...statement.keys };
  statement.retired.forEach((id) => delete resolved[id]);
  return resolved;
}

/** Accepts a statement if it is genuine and not older than the current one. Returns { ok, version } or { ok:false, problem }. */
function applyStatement({ installedFile, statementFile, raw, signature, keyId }) {
  const { root } = readInstalled(installedFile);
  const statement = readStatement(raw, signature, keyId, root);
  if (!statement) return { ok: false, problem: 'The key change could not be verified.' };
  const stored = readJsonOr(statementFile);
  const current = stored ? readStatement(stored.raw, stored.signature, stored.key_id, root) : null;
  if (current && statement.version < current.version) return { ok: false, problem: 'That key change is older than the one already in use.' };
  if (!current || statement.version > current.version) writeJsonDurable(statementFile, { raw, signature, key_id: keyId });
  return { ok: true, version: statement.version };
}

/** Reads a statement file as shipped beside an offline update, if one is there. */
function loadStatementFile(file) {
  if (!fs.existsSync(file)) return null;
  return readJsonOr(file);
}

module.exports = { resolveTrust, applyStatement, readStatement, loadStatementFile };
