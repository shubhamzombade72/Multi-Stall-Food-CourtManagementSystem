/**
 * Creates the release signing key pair. The private key is written only to the path given, which must be outside the
 * repository, and never leaves this PC. Prints the public half to add to electron/update-trust.json before building an
 * installer, and to FOODCOURT_UPDATE_TRUSTED_KEYS on the update service.
 *
 *   node scripts/release/keygen.mjs --out D:\keys\foodcourt-update-signing.pem --id prod-2026
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyInsideRepo, repoRootFrom } from './lib.mjs';

const value = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = value('out');
const id = value('id');
if (!out || !id || !/^[A-Za-z0-9._-]{1,40}$/.test(id)) {
  console.error('Usage: keygen.mjs --out <file outside the repository> --id <key id>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
if (keyInsideRepo(out, repoRootFrom(here))) {
  console.error('Refused: the private key must be kept outside the repository.');
  process.exit(1);
}
if (existsSync(out)) {
  console.error('Refused: that file already exists. A signing key is never overwritten.');
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(resolve(out), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
console.log(JSON.stringify({ key_id: id, public_key: pub, trust_file_entry: { [id]: pub }, service_env: `FOODCOURT_UPDATE_TRUSTED_KEYS=${id}:${pub}` }, null, 2));
