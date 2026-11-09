/**
 * Changes which keys may sign updates, using the offline root key. Add the new key before retiring the old one.
 *
 *   node scripts/release/rotate-trust.mjs --root-key <file outside the repo> --root-id root-2026 --version 2 --add k2:<public key> --retire k1 --out trust-statement.json
 *
 * --version must be higher than any statement issued before. Clients refuse a lower one. --add and --retire may repeat.
 * Delivery: beside an offline update (export-offline --statement) or through the update service setting
 * FOODCOURT_UPDATE_TRUST_STATEMENT.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyInsideRepo, repoRootFrom } from './lib.mjs';

const require = createRequire(import.meta.url);
const { signManifest } = require('../../electron/update/format.cjs');

const all = (name) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
const one = (name) => all(name)[0];
const fail = (m) => {
  console.error(`ROTATION STOPPED: ${m}`);
  process.exit(1);
};

const rootKey = one('root-key');
const rootId = one('root-id');
const version = Number(one('version'));
const out = one('out');
if (!rootKey || !rootId || !out || !Number.isInteger(version) || version < 1) fail('--root-key, --root-id, --version <n> and --out are required.');
if (keyInsideRepo(rootKey, repoRootFrom(dirname(fileURLToPath(import.meta.url))))) fail('The root key is inside the repository. Keep it outside, on protected storage.');
if (!existsSync(rootKey)) fail('The root key was not found.');
if (existsSync(out)) fail(`${out} already exists, and it is never overwritten.`);

const keys = {};
for (const entry of all('add')) {
  const at = String(entry).indexOf(':');
  const id = String(entry).slice(0, at);
  const pub = String(entry).slice(at + 1);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(id) || Buffer.from(pub, 'base64').length !== 32) fail(`--add needs id:<32-byte base64 public key>, got ${id}.`);
  keys[id] = pub;
}
const retired = all('retire');
if (!Object.keys(keys).length && !retired.length) fail('Nothing to change: give --add or --retire.');
if (retired.some((id) => keys[id])) fail('The same key cannot be added and retired.');

const raw = JSON.stringify({ version, keys, retired, issued_at: new Date().toISOString() });
writeFileSync(resolve(out), JSON.stringify({ raw, signature: signManifest(raw, readFileSync(rootKey, 'utf8')), key_id: rootId }, null, 2), { flag: 'wx' });
console.log(`TRUST_STATEMENT_WRITTEN ${resolve(out)}`);
