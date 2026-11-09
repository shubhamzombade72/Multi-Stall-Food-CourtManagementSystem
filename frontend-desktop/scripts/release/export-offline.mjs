/**
 * Copies a built, signed release to a folder for a PC with no internet, normally on a pen drive.
 *
 *   node scripts/release/export-offline.mjs --version 1.3.0 --out E:\ [--store <dir>] [--package full|incremental-1.2.0] [--statement <file>]
 *
 * The client chooses that folder under Software updates. Nothing here is secret: the signature is what protects it, and a
 * changed file is refused. The package is the full one unless asked otherwise, since it works from any installed version.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { manifestProblems, sha256File } = require('../../electron/update/format.cjs');
const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const value = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const fail = (m) => {
  console.error(`EXPORT STOPPED: ${m}`);
  process.exit(1);
};

const version = value('version');
const out = value('out');
if (!version || !out) fail('--version x.y.z and --out <folder> are required.');
const store = resolve(value('store') || join(DESKTOP, 'release', 'updates'));
const from = join(store, version, value('package') || 'full');
for (const f of ['manifest.json', 'manifest.sig', 'payload.fcpkg']) if (!existsSync(join(from, f))) fail(`${join(from, f)} was not found. Build the release first.`);

const raw = readFileSync(join(from, 'manifest.json'), 'utf8');
const manifest = JSON.parse(raw);
const problems = manifestProblems(manifest);
if (problems.length) fail(`The manifest is not valid: ${problems[0]}`);
if ((await sha256File(join(from, 'payload.fcpkg'))) !== manifest.payload_sha256) fail('The built package does not match its manifest.');

const target = join(resolve(out), `MangalMurti-POS-Update-${version}`);
if (existsSync(target)) fail(`${target} already exists, and an existing export is never overwritten.`);
mkdirSync(target, { recursive: true });
for (const f of ['manifest.json', 'manifest.sig', 'payload.fcpkg']) copyFileSync(join(from, f), join(target, f));
if (value('statement')) copyFileSync(resolve(value('statement')), join(target, 'trust-statement.json'));

if ((await sha256File(join(target, 'payload.fcpkg'))) !== manifest.payload_sha256) fail('The copy failed its check. Try another drive.');
console.log(`OFFLINE_UPDATE_READY ${target}`);
