/**
 * Each kind of update the system must handle, as a real package applied with real PHP and SQLite. What differs is which
 * steps it needs: a UI-only update must not claim a database change, and a paired terminal must not touch any database.
 *
 *   pnpm build && pnpm prepare:server
 *   node --test tests/update-types.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addOrders, createLab, format, hasBuild, hasTable, migrationSource, rel, totals } from './fixtures/update-lab.mjs';

const skip = hasBuild ? false : 'needs pnpm build && pnpm prepare:server';
let lab;
let v1;

before(() => {
  if (skip) return;
  lab = createLab();
  v1 = lab.makeTree('v1');
  lab.buildRelease('1.0.0', v1);
}, { timeout: 200000 });

after(() => {
  if (lab) lab.cleanup();
});

async function applyVariant(version, mutate, expectCategories, { migrates = false } = {}) {
  const tree = lab.makeTree(`t-${version}`, mutate);
  lab.buildRelease(version, tree, { baseline: '1.0.0', extra: ['--incremental-only'] });
  const dir = lab.packageDir(version, 'incremental-1.0.0');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const [category, value] of Object.entries(expectCategories)) assert.equal(manifest.changes.categories[category], value, category);

  const client = lab.makeClient(`c-${version}`, v1, '1.0.0');
  await lab.seedClient(client);
  addOrders(client.db, 10);
  const before_ = totals(client.db);
  const { b, statuses } = lab.bootstrapFor(client);
  const result = await b.run(lab.jobFor(client, version, 'incremental-1.0.0'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(totals(client.db), before_, 'business data unchanged');
  assert.equal(statuses.includes('MIGRATING'), migrates, `statuses: ${statuses}`);
  assert.equal(rel.readActive(client.dirs).version, version);
  assert.equal((await rel.verifyInstalledTree(rel.releaseDir(client.dirs, version), manifest)).ok, true, 'every file of the release verifies');
  return { client, manifest, dir: rel.releaseDir(client.dirs, version) };
}

test('UI/UX update: frontend files only, no database step', { skip, timeout: 200000 }, async () => {
  const { manifest, dir } = await applyVariant('1.1.1', ({ appDir }) => writeFileSync(join(appDir, 'dist', 'ui.js'), 'ui'), { frontend: true, backend: false, migrations: false, php_runtime: false });
  assert.equal(manifest.database.changes_schema, false);
  assert.ok(existsSync(join(dir, 'app', 'dist', 'ui.js')));
});

test('bug fix or backend/API update: backend code only, including a deleted file', { skip, timeout: 200000 }, async () => {
  const { manifest, dir } = await applyVariant('1.1.2', ({ serverDir }) => {
    writeFileSync(join(serverDir, 'backend', 'app', 'Services', 'FixedService.php'), '<?php\nnamespace App\\Services;\nclass FixedService {}\n');
    rmSync(join(serverDir, 'backend', 'app', 'Console', 'Commands', 'SeedIndianDemoCommand.php'));
  }, { backend: true, frontend: false, migrations: false });
  assert.deepEqual(manifest.deleted_files, ['server/backend/app/Console/Commands/SeedIndianDemoCommand.php']);
  assert.equal(existsSync(join(dir, 'server', 'backend', 'app', 'Console', 'Commands', 'SeedIndianDemoCommand.php')), false, 'the deleted file is gone from the new release');
  assert.equal(existsSync(join(v1.serverDir, 'backend', 'app', 'Console', 'Commands', 'SeedIndianDemoCommand.php')), true, 'and the installed files are untouched');
});

test('database schema migration', { skip, timeout: 200000 }, async () => {
  const { client } = await applyVariant('1.1.3', ({ migrations }) => writeFileSync(join(migrations, '2041_01_01_000000_new_table.php'), migrationSource("Schema::create('type_test', function (Blueprint $t) { $t->id(); });")), { migrations: true }, { migrates: true });
  assert.equal(hasTable(client.db, 'type_test'), true);
});

test('configuration update', { skip, timeout: 200000 }, async () => {
  const { dir } = await applyVariant('1.1.4', ({ appDir }) => {
    const f = join(appDir, 'electron', 'app-config.json');
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), updateServerUrl: 'https://updates.example/api' }));
  }, { configuration: true, desktop: false });
  assert.match(readFileSync(join(dir, 'app', 'electron', 'app-config.json'), 'utf8'), /updates\.example/);
});

test('dependency update: composer packages are detected and listed', { skip, timeout: 200000 }, async () => {
  const { manifest } = await applyVariant('1.1.5', ({ serverDir }) => {
    const lockFile = join(serverDir, 'backend', 'composer.lock');
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    lock.packages.push({ name: 'synthetic/new-package', version: '1.0.0' });
    writeFileSync(lockFile, JSON.stringify(lock));
    writeFileSync(join(serverDir, 'backend', 'vendor', 'synthetic-new-package.txt'), 'x');
  }, { backend_dependencies: true });
  assert.deepEqual(manifest.required_dependencies.composer, [{ name: 'synthetic/new-package', change: 'added', to: '1.0.0' }]);
});

test('security or performance update: PHP runtime files can change too', { skip, timeout: 200000 }, async () => {
  await applyVariant('1.1.6', ({ serverDir }) => writeFileSync(join(serverDir, 'php', 'license.txt'), 'patched runtime'), { php_runtime: true, backend: false });
});

test('complete application release: full package replaces everything, from any installed version', { skip, timeout: 200000 }, async () => {
  const tree = lab.makeTree('t-full', ({ appDir }) => writeFileSync(join(appDir, 'dist', 'whole.js'), 'whole'));
  lab.buildRelease('1.2.0', tree);
  const manifest = JSON.parse(readFileSync(join(lab.packageDir('1.2.0', 'full'), 'manifest.json'), 'utf8'));
  assert.equal(manifest.package_type, 'full');
  assert.equal(manifest.files.length, manifest.tree.length);
  const client = lab.makeClient('c-full', v1, '0.5.0');
  await lab.seedClient(client);
  addOrders(client.db, 10);
  const before_ = totals(client.db);
  const result = await lab.bootstrapFor(client).b.run(lab.jobFor(client, '1.2.0', 'full', { previous: '0.5.0' }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(totals(client.db), before_);
});

test('paired terminal (no local database): program files switch, no backup, no migration, no database file created', { skip, timeout: 200000 }, async () => {
  const tree = lab.makeTree('t-remote', ({ appDir, migrations }) => {
    writeFileSync(join(appDir, 'dist', 'terminal.js'), 'x');
    writeFileSync(join(migrations, '2042_01_01_000000_host_only.php'), migrationSource("Schema::create('host_only', function (Blueprint $t) { $t->id(); });"));
  });
  lab.buildRelease('1.3.0', tree, { baseline: '1.0.0', extra: ['--incremental-only'] });
  const client = lab.makeClient('c-remote', v1, '1.0.0');
  const { b, statuses } = lab.bootstrapFor(client);
  const result = await b.run(lab.jobFor(client, '1.3.0', 'incremental-1.0.0', { mode: 'remote' }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(statuses, ['VERIFYING', 'INSTALLING', 'HEALTH_CHECK']);
  assert.equal(existsSync(client.db), false, 'a terminal keeps no database');
  assert.equal(existsSync(client.dirs.recovery), false);
  assert.equal(rel.readActive(client.dirs).version, '1.3.0');
  assert.ok(format.isValidVersion(rel.readActive(client.dirs).version));
});
