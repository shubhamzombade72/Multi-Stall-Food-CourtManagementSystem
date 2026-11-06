/**
 * The update system's rules on their own: package format and signatures, what may never be packaged, how migrations are judged,
 * what a start of the app decides after any crash, when a database may be restored, and what the agent refuses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeMigration, categorize, classifyPath, collectTree, dependencyChanges, diffTrees, evaluateMigrations, keyInsideRepo, normalizedChecksum, scanContent, upMethodBody } from '../scripts/release/lib.mjs';

const require = createRequire(import.meta.url);
const format = require('../electron/update/format.cjs');
const rel = require('../electron/update/releases.cjs');
const recovery = require('../electron/update/recovery.cjs');
const { compatibilityProblem, createUpdateAgent, updateUrlProblem } = require('../electron/update/agent.cjs');

const temp = (p = 'fc-upd-') => mkdtempSync(join(tmpdir(), p));

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64') };
}

const minimalManifest = (over = {}) => ({
  format: 1, release_id: 'r', version: '1.1.0', package_type: 'full', source_version: null, payload_sha256: 'a'.repeat(64), payload_size: 10,
  files: [{ path: 'app/a.js', sha256: 'b'.repeat(64), size: 1, offset: 0, csize: 10 }], tree: [{ path: 'app/a.js', sha256: 'b'.repeat(64), size: 1 }], ...over,
});

// ------------------------------------------------------------------ versions and paths
test('versions compare numerically, not as text', () => {
  assert.equal(format.compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(format.compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(format.compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(format.isValidVersion('1.2.0'), true);
  for (const bad of ['1.2', '1.2.0-beta', 'v1.2.0', '', null]) assert.equal(format.isValidVersion(bad), false);
});

test('a release path can never leave the release folder or the two allowed trees', () => {
  for (const ok of ['app/dist/index.html', 'server/backend/artisan', 'server/php/ext/php_openssl.dll']) assert.equal(format.isSafeReleasePath(ok), true, ok);
  const bad = ['../x', 'app/../../x', 'app\\x', '/app/x', 'C:/x', 'app/C:x', 'data/foodcourt.sqlite', 'app', 'app//x', 'app/./x', 'app/con.txt', 'app/nul', 'app/x.', 'app/x ', ''];
  for (const p of bad) assert.equal(format.isSafeReleasePath(p), false, p);
  assert.throws(() => format.resolveInside(temp(), '../../evil'), /Unsafe/);
});

// ------------------------------------------------------------------ signatures
test('a signature only verifies with a trusted key over the exact bytes', () => {
  const a = keys();
  const b = keys();
  const raw = '{"format":1}';
  const sig = format.signManifest(raw, a.pem);
  assert.equal(format.verifySignature(raw, sig, 'a', { a: a.pub }), true);
  assert.equal(format.verifySignature(`${raw} `, sig, 'a', { a: a.pub }), false, 'one changed byte');
  assert.equal(format.verifySignature(raw, sig, 'a', { a: b.pub }), false, 'another key');
  assert.equal(format.verifySignature(raw, sig, 'x', { a: a.pub }), false, 'unknown key id');
  assert.equal(format.verifySignature(raw, sig, 'a', {}), false, 'no trusted key');
  assert.equal(format.verifySignature(raw, 'AAAA', 'a', { a: a.pub }), false, 'malformed signature');
  assert.equal(format.verifySignature(raw, sig, '__proto__', { a: a.pub }), false);
});

test('with no trusted key nothing loads: updates stay off', () => {
  const r = rel.loadManifest('{}', 'x', 'k', {});
  assert.equal(r.ok, false);
  assert.match(r.problem, /disabled/);
});

test('a validly signed but malformed manifest is still refused', () => {
  const k = keys();
  for (const m of [minimalManifest({ version: '1.2' }), minimalManifest({ package_type: 'x' }), minimalManifest({ package_type: 'incremental', source_version: null }), minimalManifest({ tree: [{ path: '../x', sha256: 'b'.repeat(64), size: 1 }], files: [] }), minimalManifest({ files: [{ path: 'app/other.js', sha256: 'b'.repeat(64), size: 1, offset: 0, csize: 1 }] })]) {
    const raw = JSON.stringify(m);
    assert.equal(rel.loadManifest(raw, format.signManifest(raw, k.pem), 'k', { k: k.pub }).ok, false);
  }
  const good = JSON.stringify(minimalManifest());
  assert.equal(rel.loadManifest(good, format.signManifest(good, k.pem), 'k', { k: k.pub }).ok, true);
});

test('payload entries round-trip and a damaged block is detected', async () => {
  const dir = temp();
  writeFileSync(join(dir, 'a'), 'alpha');
  writeFileSync(join(dir, 'b'), Buffer.alloc(5000, 7));
  const out = join(dir, 'p.fcpkg');
  const payload = await format.writePayload([{ path: 'app/a', source: join(dir, 'a') }, { path: 'app/b', source: join(dir, 'b') }], out);
  assert.equal(payload.payload_sha256, await format.sha256File(out));
  assert.equal(statSync(out).size, payload.payload_size);
  const fs = require('node:fs');
  const fd = fs.openSync(out, 'r');
  assert.equal(format.readPayloadEntry(fd, payload.entries[0]).toString(), 'alpha');
  assert.equal(format.readPayloadEntry(fd, payload.entries[1]).length, 5000);
  assert.throws(() => format.readPayloadEntry(fd, { ...payload.entries[0], sha256: 'f'.repeat(64) }), /damaged/);
  assert.throws(() => format.readPayloadEntry(fd, { ...payload.entries[1], offset: payload.payload_size + 10 }), /truncated/);
  fs.closeSync(fd);
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ what may be packaged
test('secrets, databases, backups and credentials are refused by name', () => {
  for (const p of ['server/backend/.env', 'server/backend/.env.production', 'server/x/foodcourt.sqlite', 'server/x/a.db', 'server/x/a.sqlite-wal', 'app/signing.pfx', 'app/id_ed25519', 'app/update-signing.pem', 'server/backend/auth.json', 'server/app.key', 'server/backups/x.txt', 'server/backend/storage/logs/l.log', 'server/backend/storage/app/menu-images/a.jpg']) {
    assert.equal(classifyPath(p).action === 'forbid' || classifyPath(p).action === 'skip', true, p);
    if (!p.endsWith('.log')) assert.equal(classifyPath(p).action, 'forbid', p);
  }
  for (const p of ['server/backend/.env.example', 'server/backend/app/Models/User.php', 'app/dist/index.html']) assert.equal(classifyPath(p).action, 'keep', p);
  for (const p of ['app/x/node_modules/a.js', 'server/backend/tests/a.php', 'app/dist/a.js.map', 'server/a.tmp']) assert.equal(classifyPath(p).action, 'skip', p);
});

test('a private key or password inside an innocent file stops the build', () => {
  assert.ok(scanContent('app/x.txt', Buffer.from('-----BEGIN PRIVATE KEY-----\nabc')));
  assert.ok(scanContent('app/x.txt', Buffer.from('-----BEGIN RSA PRIVATE KEY-----')));
  assert.ok(scanContent('app/x.cfg', Buffer.from('APP_KEY=base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')));
  assert.ok(scanContent('app/x.cfg', Buffer.from('DB_PASSWORD=hunter2')));
  assert.equal(scanContent('app/x.txt', Buffer.from('nothing to see')), null);
  assert.equal(scanContent('app/x.dll', Buffer.from('-----BEGIN PRIVATE KEY-----')), null, 'binary files are not text-scanned');

  const dir = temp();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'ok.js'), 'ok');
  writeFileSync(join(dir, 'src', 'bad.js'), '-----BEGIN PRIVATE KEY-----');
  writeFileSync(join(dir, 'src', '.env'), 'X=1');
  const { files, forbidden } = collectTree({ 'app/x': join(dir, 'src') });
  assert.deepEqual(files.map((f) => f.path), ['app/x/ok.js']);
  assert.deepEqual(forbidden.map((f) => f.path).sort(), ['app/x/.env', 'app/x/bad.js']);
  rmSync(dir, { recursive: true, force: true });
});

test('a private signing key inside the repository is refused', () => {
  const repo = resolve('.');
  assert.equal(keyInsideRepo(join(repo, 'a.pem'), repo), true);
  assert.equal(keyInsideRepo(join(repo, 'x', 'y', 'a.pem'), repo), true);
  assert.equal(keyInsideRepo(join(tmpdir(), 'a.pem'), repo), false);
});

test('the private key is not anywhere in what ships', () => {
  const trust = JSON.parse(readFileSync(resolve('electron/update-trust.json'), 'utf8'));
  assert.deepEqual(trust.keys, {}, 'no key is committed; the owner adds their public key');
  assert.doesNotMatch(readFileSync(resolve('electron/update-trust.json'), 'utf8'), /PRIVATE KEY/);
});

// ------------------------------------------------------------------ change detection
test('added, modified and deleted files are detected against the baseline', () => {
  const base = [{ path: 'app/a', sha256: '1' }, { path: 'app/b', sha256: '2' }, { path: 'app/c', sha256: '3' }];
  const now = [{ path: 'app/a', sha256: '1' }, { path: 'app/b', sha256: '9' }, { path: 'app/d', sha256: '4' }];
  assert.deepEqual(diffTrees(base, now), { added: ['app/d'], modified: ['app/b'], deleted: ['app/c'] });
});

test('changes are categorised by what kind of update they are', () => {
  const c = categorize(['app/dist/index.js', 'server/backend/app/Models/X.php', 'server/backend/database/migrations/2026_x.php', 'server/backend/vendor/a/b.php', 'server/php/php.exe', 'app/electron/main.cjs', 'server/backend/config/app.php', 'app/dist/sounds/a.wav']);
  assert.deepEqual(c, { frontend: true, desktop: true, backend: true, configuration: true, migrations: true, backend_dependencies: true, php_runtime: true, resources: true });
  assert.equal(categorize(['app/dist/x.js']).backend, false);
  assert.equal(categorize(['app/dist/x.js']).migrations, false);
});

test('dependency changes are listed', () => {
  assert.deepEqual(dependencyChanges({ a: '1', b: '1', c: '1' }, { a: '1', b: '2', d: '1' }), [
    { name: 'b', change: 'changed', from: '1', to: '2' }, { name: 'd', change: 'added', to: '1' }, { name: 'c', change: 'removed', from: '1' },
  ]);
});

// ------------------------------------------------------------------ migration rules
const mig = (up, down = '', head = '') => `<?php ${head}\nreturn new class { public function up(): void { ${up} } public function down(): void { ${down} } };`;

test('only up() counts, and comments do not', () => {
  assert.match(upMethodBody(mig('A();', 'B();')), /A\(\)/);
  assert.doesNotMatch(upMethodBody(mig('A();', 'B();')), /B\(\)/);
  assert.deepEqual(analyzeMigration(mig("Schema::create('x', fn () => 1);", "Schema::dropIfExists('x');")).destructive, []);
  assert.deepEqual(analyzeMigration(mig("// Schema::dropIfExists('x');\n Schema::create('x', fn () => 1);")).destructive, []);
});

test('destructive statements in up() are recognised', () => {
  for (const up of ["Schema::dropIfExists('orders');", "Schema::drop('orders');", "$t->dropColumn('a');", "$t->renameColumn('a','b');", "DB::table('orders')->delete();", "DB::table('orders')->truncate();", "DB::statement('DROP TABLE orders');", "DB::statement('DELETE FROM orders');", "DB::statement('ALTER TABLE orders DROP COLUMN a');", "Schema::rename('a','b');"]) {
    assert.ok(analyzeMigration(mig(up)).destructive.length > 0, up);
  }
  for (const up of ["Schema::create('x', fn () => 1);", "Schema::table('x', fn ($t) => $t->string('a')->nullable());", "DB::table('x')->update(['a' => 1]);"]) {
    assert.deepEqual(analyzeMigration(mig(up)).destructive, [], up);
  }
});

function migrationDir(files) {
  const dir = temp();
  return Object.entries(files).map(([name, source]) => {
    const file = join(dir, `${name}.php`);
    writeFileSync(file, source);
    return { path: `server/backend/database/migrations/${name}.php`, source: file };
  });
}

test('a destructive migration needs a stated recovery strategy, and then is not backward compatible', () => {
  const tree = migrationDir({ a: mig("Schema::create('t', fn () => 1);"), b: mig("Schema::dropIfExists('old');") });
  const base = [{ id: 'a', sha256: normalizedChecksum(readFileSync(tree[0].source)) }];
  const blocked = evaluateMigrations(tree, base);
  assert.match(blocked.problems[0], /declares no @update-recovery/);
  assert.equal(blocked.backward_compatible, true);

  const allowed = evaluateMigrations(migrationDir({ a: mig("Schema::create('t', fn () => 1);"), b: mig("Schema::dropIfExists('old');", '', '// @update-recovery: restore the recovery point; old had no rows since 1.1') }), base);
  assert.deepEqual(allowed.problems, []);
  assert.equal(allowed.backward_compatible, false);
  assert.equal(allowed.migrations[1].destructive, true);
});

test('editing or removing a migration that already shipped is refused', () => {
  const tree = migrationDir({ a: mig('Changed();') });
  assert.match(evaluateMigrations(tree, [{ id: 'a', sha256: 'old' }]).problems[0], /edited after it shipped/);
  assert.match(evaluateMigrations(tree, [{ id: 'a', sha256: normalizedChecksum(readFileSync(tree[0].source)) }, { id: 'gone', sha256: 'x' }]).problems[0], /removed after it shipped/);
});

test('a dependency on a migration that does not exist is refused', () => {
  const tree = migrationDir({ a: mig('A();', '', '// @update-depends: nothing_here') });
  assert.match(evaluateMigrations(tree, []).problems[0], /depends on nothing_here/);
});

test('line endings do not change a migration checksum', () => {
  assert.equal(normalizedChecksum(Buffer.from('a\r\nb')), normalizedChecksum(Buffer.from('a\nb')));
});

// ------------------------------------------------------------------ what a start of the app does
test('every crash point leads to a defined start decision', () => {
  assert.deepEqual(rel.decideBoot({ journal: null, active: null }), { action: 'run', release: null, trial: false });
  assert.deepEqual(rel.decideBoot({ journal: null, active: { version: '1.1.0', state: 'confirmed' } }), { action: 'run', release: '1.1.0', trial: false });
  for (const phase of ['PREPARED', 'BACKUP', 'MIGRATING', 'MIGRATED', 'INSTALLING', 'HEALTH_CHECK']) {
    assert.equal(rel.decideBoot({ journal: { phase }, active: null }).action, 'recover', phase);
  }
  assert.deepEqual(rel.decideBoot({ journal: { phase: 'TRIAL' }, active: { version: '1.1.0', state: 'trial', boot_attempts: 0 } }), { action: 'run', release: '1.1.0', trial: true });
  assert.equal(rel.decideBoot({ journal: { phase: 'TRIAL' }, active: { version: '1.1.0', state: 'trial', boot_attempts: rel.MAX_TRIAL_BOOTS } }).action, 'recover');
  assert.equal(rel.decideBoot({ journal: { phase: 'NEEDS_DEVELOPER', message: 'stop' }, active: null }).action, 'blocked');
});

test('database restore rule: never over possibly newer transactions', () => {
  for (const phase of ['BACKUP', 'MIGRATING', 'MIGRATED', 'INSTALLING', 'HEALTH_CHECK']) assert.equal(recovery.restoreDecision({ phase }).safe, true, phase);
  assert.equal(recovery.restoreDecision({ phase: 'TRIAL', currentSha: 'a', postMigrationSha: 'a' }).safe, true);
  assert.equal(recovery.restoreDecision({ phase: 'TRIAL', currentSha: 'b', postMigrationSha: 'a' }).safe, false, 'database changed after migrating');
  assert.equal(recovery.restoreDecision({ phase: 'TRIAL', currentSha: 'b', postMigrationSha: null }).safe, false);
  assert.equal(recovery.restoreDecision({ phase: 'DONE' }).safe, false, 'after confirmation never automatic');
  assert.equal(recovery.restoreDecision({ phase: 'unknown' }).safe, false);
});

test('recovery point pruning keeps the newest and anything referenced', () => {
  const dir = temp();
  const names = ['rp-1', 'rp-2', 'rp-3', 'rp-4', 'rp-5'];
  names.forEach((n) => {
    mkdirSync(join(dir, n));
    writeFileSync(join(dir, n, 'metadata.json'), '{}');
  });
  mkdirSync(join(dir, 'rp-0-incomplete'));
  assert.deepEqual(recovery.pruneRecoveryPoints(dir, { keep: 2, referenced: ['rp-1'] }), ['rp-2', 'rp-3']);
  assert.equal(existsSync(join(dir, 'rp-1')), true);
  assert.equal(existsSync(join(dir, 'rp-5')), true);
  assert.deepEqual(recovery.pruneRecoveryPoints(dir, { keep: 100 }), []);
  rmSync(dir, { recursive: true, force: true });
});

test('low disk is refused from the free space actually reported', async () => {
  const dir = temp();
  const statfs = async () => ({ bavail: 100, bsize: 4096 });
  const r = await recovery.checkDiskSpace(dir, recovery.requiredBytes({ dbBytes: 1000 }), statfs);
  assert.equal(r.ok, false);
  assert.equal((await recovery.checkDiskSpace(dir, 1000, statfs)).ok, true);
  assert.ok(recovery.requiredBytes({ dbBytes: 100 }) > 200, 'room for a backup and growth');
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ agent rules
const compat = (over = {}) => compatibilityProblem({ manifest: { version: '1.3.0', package_type: 'full', compatibility: { platform: 'win32', electron_major: 44, api_contract: 1 } }, currentVersion: '1.2.0', highest: null, electronMajor: 44, mode: 'embedded', hostContract: null, ...over });

test('compatibility refusals', () => {
  assert.equal(compat().ok, true);
  assert.equal(compat({ currentVersion: '1.3.0' }).code, 'downgrade', 'same version');
  assert.equal(compat({ currentVersion: '1.4.0' }).code, 'downgrade', 'older');
  assert.equal(compat({ highest: '1.5.0' }).code, 'downgrade', 'a newer version already ran here');
  assert.equal(compat({ electronMajor: 45 }).code, 'requires_full_installer');
  const m = (o) => ({ version: '1.3.0', package_type: 'full', compatibility: {}, ...o });
  assert.equal(compat({ manifest: m({ package_type: 'incremental', source_version: '1.1.0' }) }).code, 'wrong_source');
  assert.equal(compat({ manifest: m({ min_supported_version: '1.3.0' }) }).code, 'below_minimum');
  assert.equal(compat({ mode: 'remote', hostContract: null }).code, 'host_too_old', 'unknown host contract is not accepted');
  assert.equal(compat({ mode: 'remote', hostContract: 0 }).code, 'host_too_old');
  assert.equal(compat({ mode: 'remote', hostContract: 1 }).ok, true);
});

test('update traffic must be https, except to this PC', () => {
  assert.equal(updateUrlProblem('https://updates.example/api'), null);
  assert.equal(updateUrlProblem('http://127.0.0.1:9000/api'), null);
  assert.match(updateUrlProblem('http://updates.example/api'), /https/);
  assert.match(updateUrlProblem('http://192.168.1.5/api'), /https/);
  assert.match(updateUrlProblem(''), /No update service/);
});

function agentFor(root, over = {}) {
  const dirs = rel.layout(root);
  return createUpdateAgent({
    dirs,
    trusted: { k: 'AAAA' },
    seal: (t) => Buffer.from(t),
    unseal: (b) => b.toString(),
    getCurrentVersion: () => '1.2.0',
    getMode: () => 'embedded',
    getDataDir: () => root,
    getServerUrl: () => 'http://127.0.0.1:1/api',
    electronMajor: 44,
    installed: () => ({ version: '1.2.0', app: root, server: root }),
    startBootstrap: async () => assert.fail('must not install'),
    ...over,
  });
}

test('without a key or a service the agent reports why, and contacts nothing', async () => {
  const dir = temp();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('no');
  };
  assert.match((await agentFor(dir, { trusted: {}, fetchImpl }).check()).blocked, /disabled/);
  assert.match((await agentFor(dir, { getServerUrl: () => 'http://updates.example/api', fetchImpl }).check()).blocked, /https/);
  assert.equal(calls, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('the agent installs nothing by itself: a check with an offer only reports it', async () => {
  const dir = temp();
  const fetchImpl = async (url) => new Response(JSON.stringify(url.endsWith('/enroll')
    ? { data: { token: 't'.repeat(64), client_id: 1, channel: 'stable' } }
    : { data: { update: { target_id: 1, version: '1.3.0', status: 'UPDATE_AVAILABLE', required: false, package_type: 'full', package_size: 5, notes: { features: ['x'] } } } }), { status: url.endsWith('/enroll') ? 201 : 200 });
  const agent = agentFor(dir, { fetchImpl });
  assert.equal((await agent.enroll('CODE', 'pc')).ok, true);
  const state = await agent.check();
  assert.equal(state.update.version, '1.3.0');
  assert.equal(state.phase, 'idle');
  agent.remindLater();
  assert.equal(agent.publicState().snoozed, true);
  rmSync(dir, { recursive: true, force: true });
});

test('the device token is sealed on disk and an older or equal offer is ignored', async () => {
  const dir = temp();
  const fetchImpl = async (url) => new Response(JSON.stringify(url.endsWith('/enroll')
    ? { data: { token: 'SECRET'.repeat(10), client_id: 1, channel: 'stable' } }
    : { data: { update: { target_id: 1, version: '1.1.0', required: false, package_type: 'full', package_size: 5 } } }), { status: url.endsWith('/enroll') ? 201 : 200 });
  const agent = agentFor(dir, { fetchImpl, seal: (t) => Buffer.from(t).map((b) => b ^ 0x5a), unseal: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString() });
  await agent.enroll('CODE', 'pc');
  assert.doesNotMatch(readFileSync(rel.layout(dir).device, 'utf8'), /SECRET/);
  assert.equal((await agent.check()).update, null);
  rmSync(dir, { recursive: true, force: true });
});

test('reports wait in the outbox for the network and are delivered in order', async () => {
  const dir = temp();
  const seen = [];
  let online = false;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/enroll')) return new Response(JSON.stringify({ data: { token: 't'.repeat(64), client_id: 1, channel: 'stable' } }), { status: 201 });
    if (!online) throw new Error('offline');
    seen.push(JSON.parse(options.body).status);
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  };
  const agent = agentFor(dir, { fetchImpl });
  await agent.enroll('C', 'pc');
  const dirs = rel.layout(dir);
  ['BACKUP_IN_PROGRESS', 'MIGRATING', 'INSTALLING'].forEach((status) => rel.appendLine(dirs.outbox, { target_id: 9, status }));
  assert.equal((await agent.flushOutbox()).delivered, 0);
  assert.equal(readFileSync(dirs.outbox, 'utf8').trim().split('\n').length, 3, 'nothing lost while offline');
  online = true;
  assert.equal((await agent.flushOutbox()).delivered, 3);
  assert.deepEqual(seen, ['BACKUP_IN_PROGRESS', 'MIGRATING', 'INSTALLING']);
  assert.equal(existsSync(dirs.outbox), false);
  rmSync(dir, { recursive: true, force: true });
});

test('an interrupted download resumes from where it stopped', async () => {
  const dir = temp();
  const body = Buffer.alloc(300000, 3);
  const sha = format.sha256Buffer(body);
  const ranges = [];
  let cut = true;
  const server = createServer((req, res) => {
    const range = req.headers.range;
    ranges.push(range || 'none');
    const start = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
    res.writeHead(range ? 206 : 200, { 'Content-Length': body.length - start });
    if (cut) {
      cut = false;
      res.write(body.subarray(start, 100000), () => res.destroy());
    } else {
      res.end(body.subarray(start));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dirs = rel.layout(dir);
  mkdirSync(dirs.state, { recursive: true });
  writeFileSync(dirs.device, JSON.stringify({ device_id: 'd', token_enc: Buffer.from('t').toString('base64') }));
  const agent = agentFor(dir, { getServerUrl: () => `http://127.0.0.1:${port}/api`, fetchImpl: (u, o) => fetch(u, o) });
  const file = join(dir, 'p.fcpkg');
  const token = { token: 'x'.repeat(64), package_size: body.length, package_sha256: sha };

  await assert.rejects(agent.downloadPayload(token, file));
  assert.equal(existsSync(file), false);
  const partial = statSync(`${file}.part`).size;
  assert.ok(partial > 0 && partial < body.length);

  await agent.downloadPayload(token, file);
  assert.equal(ranges[1], `bytes=${partial}-`);
  assert.equal(await format.sha256File(file), sha);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('wiring: loader is the entry point, and preload, main and bridge agree on update calls', () => {
  assert.equal(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).main, 'electron/loader.cjs');
  const preload = readFileSync(resolve('electron/preload.cjs'), 'utf8');
  const main = readFileSync(resolve('electron/main.cjs'), 'utf8');
  const bridge = readFileSync(resolve('src/desktop/bridge.ts'), 'utf8');
  for (const key of ['updateGetState', 'updateCheck', 'updateEnroll', 'updateNow', 'updateRemindLater']) {
    assert.match(preload, new RegExp(`${key}:`));
    assert.match(main, new RegExp(`'${key}'`));
    assert.match(bridge, new RegExp(`${key}\\(`));
  }
  const loader = readFileSync(resolve('electron/loader.cjs'), 'utf8');
  assert.match(loader, /const packaged = app\.isPackaged/);
  assert.match(loader, /!packaged \? process\.env\.FOODCOURT_UPDATE_ROOT/, 'test root is ignored when installed');
  assert.match(loader, /!packaged && process\.env\.FOODCOURT_UPDATE_TRUST/, 'test key is ignored when installed');
});
