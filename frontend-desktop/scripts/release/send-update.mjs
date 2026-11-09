/**
 * The developer's one command for sending an update to every installed desktop app:
 *
 *   pnpm send-update --version 1.3.1 --notes "Fixed bill printing; Added a sales report"
 *
 * Sets the version, builds, signs with the key named in publish-config.json, and publishes to GitHub Releases. Installed apps
 * look about every 5 minutes, download it by themselves and install it once nobody has used the PC for 2 minutes.
 * Options: --required  --skip-build  --offline-out E:\ (also makes a pen-drive copy)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { compareVersions, isValidVersion } = require('../../electron/update/format.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '..', '..');

const value = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const fail = (m) => {
  console.error(`SEND UPDATE STOPPED: ${m}`);
  process.exit(1);
};

const version = value('version');
if (!isValidVersion(version)) fail('--version x.y.z is required.');
const config = JSON.parse(readFileSync(join(HERE, 'publish-config.json'), 'utf8'));

const packageFile = join(DESKTOP, 'package.json');
const text = readFileSync(packageFile, 'utf8');
const declared = JSON.parse(text).version;
if (compareVersions(version, declared) < 0) fail(`${version} is older than the current ${declared}.`);
if (version !== declared) writeFileSync(packageFile, text.replace(`"version": "${declared}"`, `"version": "${version}"`));

const lines = typeof value('notes') === 'string' ? value('notes').split(';').map((s) => s.trim()).filter(Boolean) : [];
const notesFile = join(mkdtempSync(join(tmpdir(), 'fc-send-update-')), 'notes.json');
writeFileSync(notesFile, JSON.stringify({ features: lines }));

// The last version built is the baseline, so an edited migration that already shipped still stops the build
const store = join(DESKTOP, 'release', 'updates');
const earlier = existsSync(store) ? readdirSync(store).filter((d) => isValidVersion(d) && compareVersions(d, version) < 0 && existsSync(join(store, d, 'tree.json'))).sort(compareVersions).at(-1) : undefined;

const args = ['--version', version, '--key', config.key, '--key-id', config.keyId, '--notes', notesFile, '--github', config.repo];
if (earlier) args.push('--baseline', earlier);
for (const flag of ['required', 'skip-build']) if (value(flag)) args.push(`--${flag}`);
if (typeof value('offline-out') === 'string') args.push('--offline-out', value('offline-out'));
const run = spawnSync(process.execPath, [join(HERE, 'release.mjs'), ...args], { cwd: DESKTOP, stdio: 'inherit' });
if (run.status !== 0) fail('See the step that failed above. Nothing reached any app unless it says it was published.');
console.log(`\nUPDATE_SENT ${version}: open apps notice it within about 5 minutes and install once the PC has been unused for 2 minutes. PCs on 1.3.2 or older can take up to a day.`);
