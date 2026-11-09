/**
 * Publishes a built release to the update service: creates the release, registers each signed manifest, uploads each
 * payload (the service keeps it only if it matches the signed hash), publishes, and optionally deploys.
 *
 *   FOODCOURT_RELEASE_TOKEN=<owner token> node scripts/release/publish-release.mjs --server https://updates.example/api --version 1.3.0 --publish --deploy all
 *
 * --deploy all | <client id,client id>   --exclude <client id,...>   --store <dir>
 * The token is read from the environment so that it does not appear in a command line.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { isLoopbackHost, normalizeApiUrl } = require('../../electron/config.cjs');
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

const server = normalizeApiUrl(value('server'));
if (!server) fail('--server https://host/api is required.');
if (new URL(server).protocol !== 'https:' && !isLoopbackHost(new URL(server).hostname)) fail('Releases are only published over https.');
const token = process.env.FOODCOURT_RELEASE_TOKEN;
if (!token) fail('Set FOODCOURT_RELEASE_TOKEN to an owner token of the update service.');
const version = value('version');
const store = resolve(value('store') || join(DESKTOP, 'release', 'updates'));
const dir = join(store, String(version));
if (!existsSync(join(dir, 'summary.json'))) fail(`Version ${version} has not been built in ${store}.`);

const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
async function call(method, urlPath, body) {
  const res = await fetch(`${server}${urlPath}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) fail(`${method} ${urlPath} -> HTTP ${res.status}: ${json?.message || 'no details'}`);
  return json.data;
}

const packageDirs = readdirSync(dir).filter((n) => n === 'full' || n.startsWith('incremental-'));
const firstManifest = JSON.parse(readFileSync(join(dir, packageDirs[0], 'manifest.json'), 'utf8'));
const release = await call('POST', '/update-admin/releases', {
  version,
  channel: firstManifest.channel,
  required: firstManifest.required,
  min_supported_version: firstManifest.min_supported_version,
  notes: firstManifest.notes,
});
console.log(`[publish] release ${release.id} created`);

for (const name of packageDirs) {
  const pkgDir = join(dir, name);
  const raw = readFileSync(join(pkgDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  const added = await call('POST', `/update-admin/releases/${release.id}/packages`, {
    manifest: raw,
    signature: readFileSync(join(pkgDir, 'manifest.sig'), 'utf8').trim(),
    signing_key_id: manifest.signing.key_id,
  });
  const payload = join(pkgDir, 'payload.fcpkg');
  const res = await fetch(`${server}/update-admin/releases/${release.id}/packages/${added.package_id}/payload`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(statSync(payload).size) },
    body: Readable.toWeb(createReadStream(payload)),
    duplex: 'half',
  });
  const uploaded = await res.json().catch(() => null);
  if (!res.ok) fail(`Upload of ${name} -> HTTP ${res.status}: ${uploaded?.message || 'no details'}`);
  console.log(`[publish] ${name}: ${uploaded.data.size} bytes accepted`);
}

if (value('publish')) {
  await call('POST', `/update-admin/releases/${release.id}/publish`);
  console.log('[publish] published');
}

const deploy = value('deploy');
let deployment = null;
if (deploy) {
  const list = (s) => String(s).split(',').map((x) => Number(x.trim())).filter(Boolean);
  deployment = await call('POST', '/update-admin/deployments', {
    release_id: release.id,
    scope: deploy === 'all' ? 'all' : 'selected',
    client_ids: deploy === 'all' ? undefined : list(deploy),
    exclude_client_ids: value('exclude') ? list(value('exclude')) : [],
  });
  console.log(`[publish] deployment ${deployment.id} created`);
}
console.log(`RELEASE_PUBLISHED ${JSON.stringify({ release_id: release.id, version, deployment_id: deployment?.id ?? null })}`);
