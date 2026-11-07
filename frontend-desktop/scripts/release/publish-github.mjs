/**
 * Publishes a built, signed release to GitHub Releases, which is the free update host: no server, and any installed app can
 * read it. Only the full package goes up, since it works from any installed version. Source code is not pushed anywhere.
 *
 *   node scripts/release/publish-github.mjs --repo owner/name --version 1.3.1 [--create] [--store <dir>]
 *
 * The login comes from GITHUB_TOKEN, otherwise from what Git already has saved for github.com. It is never printed.
 * The release stays a hidden draft until every file is uploaded, so an app can never see half a release.
 * --api and --uploads replace the GitHub addresses, for tests.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { manifestProblems, sha256File } = require('../../electron/update/format.cjs');
const { loadManifest } = require('../../electron/update/releases.cjs');
const { resolveTrust } = require('../../electron/update/trust.cjs');
const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const value = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const fail = (m) => {
  console.error(`PUBLISH STOPPED: ${m}`);
  process.exit(1);
};

const repo = value('repo');
const version = value('version');
if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo)) || !version) fail('--repo owner/name and --version x.y.z are required.');
const API = String(value('api') || 'https://api.github.com').replace(/\/+$/, '');
const UPLOADS = String(value('uploads') || 'https://uploads.github.com').replace(/\/+$/, '');

// ------------------------------------------------------------------ what will go up
const store = resolve(value('store') || join(DESKTOP, 'release', 'updates'));
const from = join(store, String(version), 'full');
const FILES = ['manifest.json', 'manifest.sig', 'payload.fcpkg'];
for (const f of FILES) if (!existsSync(join(from, f))) fail(`${join(from, f)} was not found. Build the release first.`);

const raw = readFileSync(join(from, 'manifest.json'), 'utf8');
const signature = readFileSync(join(from, 'manifest.sig'), 'utf8').trim();
const manifest = JSON.parse(raw);
const problems = manifestProblems(manifest);
if (problems.length) fail(`The manifest is not valid: ${problems[0]}`);
if (manifest.version !== version) fail(`That folder holds version ${manifest.version}.`);
if ((await sha256File(join(from, 'payload.fcpkg'))) !== manifest.payload_sha256) fail('The built package does not match its manifest.');

// Checked against the same key list the apps use: anything they would refuse must not be published
const trustFile = value('trust') ? resolve(value('trust')) : join(DESKTOP, 'electron', 'update-trust.json');
const loaded = loadManifest(raw, signature, manifest.signing?.key_id, resolveTrust(trustFile, join(store, 'no-statement')));
if (!loaded.ok) fail(`Installed apps would refuse this release: ${loaded.problem}`);

// ------------------------------------------------------------------ login
function savedGitLogin() {
  const run = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true, timeout: 120000 });
  return run.status === 0 ? /^password=(.+)$/m.exec(run.stdout)?.[1] : undefined;
}
const token = process.env.GITHUB_TOKEN || savedGitLogin();
if (!token) fail('No GitHub login was found. Set GITHUB_TOKEN, or sign in to GitHub with Git once.');

const github = async (method, url, { json, bytes, type, tolerant = false } = {}) => {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'mangalmurti-pos-release',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(type ? { 'Content-Type': type } : {}),
    },
    body: json ? JSON.stringify(json) : bytes,
  }).catch((err) => {
    if (tolerant) return null;
    return fail(`GitHub could not be reached (${err.cause?.code || err.message}). Check the internet connection and run the same command again: it carries on with this version.`);
  });
  if (res === null) return { status: 0, ok: false, json: { message: 'The connection dropped.' } };
  return { status: res.status, ok: res.ok, json: await res.json().catch(() => null) };
};
const refused = (what, r) => fail(`${what}: GitHub answered ${r.status}. ${r.json?.message || ''}${r.status === 401 || r.status === 403 ? ' The login needs permission to manage this repository.' : ''}`);

// ------------------------------------------------------------------ the repository, only ever a releases-only one
const repoName = repo.split('/')[1];
const found = await github('GET', `${API}/repos/${repo}`);
if (found.status === 404) {
  if (!value('create')) fail(`${repo} does not exist. Add --create to make it.`);
  const made = await github('POST', `${API}/user/repos`, { json: { name: repoName, description: 'Signed software updates for MangalMurti POS. No source code.', private: false, auto_init: true, has_issues: false, has_wiki: false, has_projects: false } });
  if (!made.ok) refused('Creating the repository', made);
  console.log(`[publish] created ${repo}`);
} else if (!found.ok) {
  refused('Reading the repository', found);
} else if (found.json?.private) {
  fail(`${repo} is private, so installed apps could not download from it.`);
}

// ------------------------------------------------------------------ draft, files, then visible
const tag = `v${version}`;
const existing = await github('GET', `${API}/repos/${repo}/releases/tags/${tag}`);
if (existing.ok) fail(`${tag} was already published. A version is never replaced; use a new version.`);

// A failed attempt leaves a hidden draft. It was never visible to any app, so it is safe to remove and start clean
const earlier = await github('GET', `${API}/repos/${repo}/releases?per_page=30`);
for (const old of earlier.ok && Array.isArray(earlier.json) ? earlier.json : []) {
  if (old.draft && old.tag_name === tag) {
    const gone = await github('DELETE', `${API}/repos/${repo}/releases/${old.id}`);
    if (gone.ok) console.log('[publish] removed an unfinished draft from an earlier attempt');
  }
}

const draft = await github('POST', `${API}/repos/${repo}/releases`, { json: { tag_name: tag, name: `MangalMurti POS ${version}`, body: JSON.stringify(manifest.notes ?? {}, null, 2), draft: true, prerelease: false } });
if (!draft.ok) refused('Creating the release', draft);

for (const name of FILES) {
  const file = join(from, name);
  console.log(`[publish] uploading ${name} (${(statSync(file).size / 1048576).toFixed(1)} MB)`);
  let up;
  // A shop or home connection can drop during a large upload. Half an asset is removed by GitHub, so the file just goes again
  for (let attempt = 1; attempt <= 4; attempt++) {
    up = await github('POST', `${UPLOADS}/repos/${repo}/releases/${draft.json.id}/assets?name=${encodeURIComponent(name)}`, { bytes: readFileSync(file), type: 'application/octet-stream', tolerant: true });
    if (up.ok) break;
    const assets = await github('GET', `${API}/repos/${repo}/releases/${draft.json.id}/assets`, { tolerant: true });
    for (const stale of assets.ok && Array.isArray(assets.json) ? assets.json.filter((a) => a.name === name) : []) await github('DELETE', `${API}/repos/${repo}/releases/assets/${stale.id}`, { tolerant: true });
    if (attempt < 4) {
      console.log(`[publish] ${name} did not finish (${up.status || 'connection dropped'}); trying again`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  if (!up.ok) refused(`Uploading ${name}`, up);
}

const live = await github('PATCH', `${API}/repos/${repo}/releases/${draft.json.id}`, { json: { draft: false, make_latest: 'true' } });
if (!live.ok) refused('Publishing the release', live);
console.log(`GITHUB_RELEASE_PUBLISHED ${JSON.stringify({ repo, version, url: live.json?.html_url ?? null })}`);
