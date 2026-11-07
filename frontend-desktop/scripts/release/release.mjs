/**
 * The developer's one command: build the app, package and sign it, make the pen-drive copy, and publish if a server is given.
 *
 *   node scripts/release/release.mjs --version 1.3.1 --baseline 1.3.0 --key <file outside the repo> --key-id prod-2026 --notes notes.json
 *        [--offline-out E:\]  [--github owner/repo]  [--server https://updates.example/api --deploy <client ids or all>]  [--skip-build]
 *
 * --version must already be in package.json. Publishing also needs FOODCOURT_RELEASE_TOKEN. Each step stops everything if it
 * fails. Nothing reaches a client unless --deploy names them, so start with one client.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '..', '..');
const value = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const fail = (m) => {
  console.error(`RELEASE STOPPED: ${m}`);
  process.exit(1);
};
const step = (title, command, args) => {
  console.log(`\n== ${title}`);
  const run = spawnSync(command, args, { cwd: DESKTOP, stdio: 'inherit', shell: command === 'pnpm' });
  if (run.status !== 0) fail(`${title} failed.`);
};
const script = (name, args) => [join(HERE, name), ...args];

const version = value('version');
if (!version) fail('--version x.y.z is required.');
const declared = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version;
if (declared !== version) fail(`package.json says ${declared}. Set it to ${version} first, so the app reports the right version.`);
if (!value('key') || !value('key-id')) fail('--key and --key-id are required.');

// A version already signed is never rebuilt. If only its upload failed, this carries on with the same signed files
const alreadyBuilt = existsSync(join(resolve(value('store') || join(DESKTOP, 'release', 'updates')), version, 'full', 'manifest.sig'));
if (alreadyBuilt) console.log(`\n== ${version} is already built and signed, so only the publish step runs`);

if (!value('skip-build') && !alreadyBuilt) {
  step('Build the desktop app', 'pnpm', ['build']);
  step('Prepare the built-in server (close any running copy first)', 'pnpm', ['prepare:server']);
}

const build = ['--version', version, '--key', value('key'), '--key-id', value('key-id')];
for (const name of ['baseline', 'notes', 'channel', 'min-supported', 'min-app-version', 'store']) if (value(name)) build.push(`--${name}`, value(name));
if (value('required')) build.push('--required');
if (!alreadyBuilt) step('Package and sign', process.execPath, script('build-release.mjs', build));

if (value('offline-out')) step('Pen-drive copy', process.execPath, script('export-offline.mjs', ['--version', version, '--out', value('offline-out'), ...(value('store') ? ['--store', value('store')] : [])]));

if (value('github')) {
  step('Publish to GitHub Releases', process.execPath, script('publish-github.mjs', ['--repo', value('github'), '--version', version, '--create', ...(value('store') ? ['--store', value('store')] : [])]));
} else if (value('server')) {
  const publish = ['--server', value('server'), '--version', version, '--publish', ...(value('store') ? ['--store', value('store')] : [])];
  if (value('deploy')) publish.push('--deploy', value('deploy'));
  step('Publish to the update service', process.execPath, script('publish-release.mjs', publish));
} else {
  console.log('\nNo --github or --server given, so nothing was published.');
}
console.log(`\nRELEASE_DONE ${version}`);
