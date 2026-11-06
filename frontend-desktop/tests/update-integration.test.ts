/**
 * The whole update with real PHP, real Laravel, real SQLite and real signed packages, minus only Electron's window
 * (e2e/update-system.e2e.mjs covers that). Each test is a client PC in a throw-away folder with synthetic data.
 *
 *   pnpm build && pnpm prepare:server
 *   node --test tests/update-integration.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { addOrders, createBootstrap, createLab, DESKTOP, format, hasBuild, hasColumn, hasTable, migrationSource, querySql, recovery, rel, runSql, totals } from './fixtures/update-lab.mjs';

const skip = hasBuild ? false : 'needs pnpm build && pnpm prepare:server';
let lab;
let v1;
let v2Tree;

const ADD_COLUMN = "Schema::table('orders', function (Blueprint $t) { $t->string('synthetic_note')->nullable(); });\n        Schema::create('synthetic_feature', function (Blueprint $t) { $t->id(); $t->string('label')->nullable(); });";

before(async () => {
  if (skip) return;
  lab = createLab();
  v1 = lab.makeTree('v1');
  lab.buildRelease('1.0.0', v1);

  // v1.1.0: one of each kind of change, the way a developer's real next build would differ
  v2Tree = lab.makeTree('v2', ({ appDir, serverDir, migrations }) => {
    writeFileSync(join(appDir, 'dist', 'synthetic-ui-change.js'), 'console.log("new ui")');
    writeFileSync(join(appDir, 'electron', 'synthetic-desktop-change.cjs'), '// new desktop file');
    writeFileSync(join(serverDir, 'backend', 'app', 'Services', 'SyntheticNewService.php'), '<?php\nnamespace App\\Services;\nclass SyntheticNewService {}\n');
    writeFileSync(join(migrations, '2030_01_01_000000_add_synthetic_note.php'), migrationSource(ADD_COLUMN));
    rmSync(join(serverDir, 'backend', 'routes', 'channels.php.synthetic'), { force: true });
  });
  lab.buildRelease('1.1.0', v2Tree, { baseline: '1.0.0' });
}, { timeout: 300000 });

after(() => {
  if (lab) lab.cleanup();
});

async function freshClient(name, tree = v1, version = '1.0.0') {
  const client = lab.makeClient(name, tree, version);
  await lab.seedClient(client);
  addOrders(client.db, 25);
  return client;
}

const outbox = (client) => {
  try {
    return readFileSync(client.dirs.outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const statusesIn = (client) => outbox(client).map((x) => x.status);

/** A version built only for one test: v1 plus these changes, as an incremental package from 1.0.0. */
function buildVariant(version, migrations, extra = {}) {
  const tree = lab.makeTree(`variant-${version}`, ({ migrations: dir }) => {
    for (const [name, source] of Object.entries(migrations)) writeFileSync(join(dir, `${name}.php`), source);
  });
  lab.buildRelease(version, tree, { baseline: '1.0.0', ...extra, extra: ['--incremental-only', ...(extra.extra || [])] });
  return tree;
}

const noDataLost = (client, before_) => assert.deepEqual(totals(client.db), before_, 'business data is exactly as it was');

// ------------------------------------------------------------------ the developer side
test('builder: incremental package holds only what changed and states it', { skip }, () => {
  const summary = JSON.parse(readFileSync(join(lab.store, '1.1.0', 'summary.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(lab.packageDir('1.1.0', 'incremental-1.0.0'), 'manifest.json'), 'utf8'));
  assert.equal(manifest.package_type, 'incremental');
  assert.equal(manifest.source_version, '1.0.0');
  assert.deepEqual(manifest.database.new_migrations, ['2030_01_01_000000_add_synthetic_note']);
  assert.equal(manifest.database.backward_compatible, true);
  assert.ok(manifest.changes.added.includes('app/dist/synthetic-ui-change.js'));
  assert.ok(manifest.changes.added.includes('server/backend/app/Services/SyntheticNewService.php'));
  assert.equal(manifest.changes.categories.frontend, true);
  assert.equal(manifest.changes.categories.desktop, true);
  assert.equal(manifest.changes.categories.backend, true);
  assert.equal(manifest.changes.categories.migrations, true);
  assert.ok(manifest.files.length < 20, `only changed files: ${manifest.files.length}`);
  assert.ok(manifest.tree.length > 5000, 'the file list still describes the whole release');
  assert.ok(manifest.payload_size < 200 * 1024, `small: ${manifest.payload_size}`);
  assert.equal(manifest.signing.key_id, 'lab');
  assert.ok(manifest.database.schema.synthetic_feature, 'expected schema is recorded');
  assert.equal(summary.new_migrations.length, 1);
  assert.equal(format.verifySignature(readFileSync(join(lab.packageDir('1.1.0', 'incremental-1.0.0'), 'manifest.json'), 'utf8'), readFileSync(join(lab.packageDir('1.1.0', 'incremental-1.0.0'), 'manifest.sig'), 'utf8'), 'lab', lab.trusted), true);
});

test('builder: nothing secret or dev-only in the real build', { skip }, () => {
  const manifest = JSON.parse(readFileSync(join(lab.packageDir('1.0.0', 'full'), 'manifest.json'), 'utf8'));
  const paths = manifest.tree.map((f) => f.path);
  assert.deepEqual(paths.filter((p) => /\.(sqlite3?|db)$|(^|\/)\.env$|\.pem$|\.pfx$|app\.key$/i.test(p)), [], 'no database, env or key file');
  assert.deepEqual(paths.filter((p) => /node_modules\/|\/tests\/|backups\//.test(p)), []);
  assert.equal(paths.some((p) => p.startsWith('server/demo/')), false, 'demo data is never in an update');
  assert.equal(readFileSync(join(lab.packageDir('1.0.0', 'full'), 'payload.fcpkg')).includes('PRIVATE KEY-----'), false);
});

test('builder: destructive migration without a strategy, edited old migration, same version, secrets all stop the build', { skip }, () => {
  const destructive = lab.makeTree('bad-destructive', ({ migrations }) => writeFileSync(join(migrations, '2031_01_01_000000_drop_orders.php'), migrationSource("Schema::dropIfExists('orders');")));
  assert.throws(() => lab.buildRelease('1.9.1', destructive, { baseline: '1.0.0' }), /no @update-recovery/);

  const edited = lab.makeTree('bad-edited', ({ migrations }) => writeFileSync(join(migrations, '2026_11_06_090000_create_update_management_tables.php'), '<?php // tampered'));
  assert.throws(() => lab.buildRelease('1.9.2', edited, { baseline: '1.0.0' }), /edited after it shipped/);

  assert.throws(() => lab.buildRelease('1.0.0', v1), /already built/);
  assert.throws(() => lab.buildRelease('0.9.0', v1, { baseline: '1.0.0' }), /not newer/);

  const secret = lab.makeTree('bad-secret', ({ serverDir }) => writeFileSync(join(serverDir, 'backend', '.env'), 'APP_KEY=x'));
  assert.throws(() => lab.buildRelease('1.9.3', secret, { baseline: '1.0.0' }), /must never be packaged/);
  const db = lab.makeTree('bad-db', ({ appDir }) => writeFileSync(join(appDir, 'dist', 'leftover.sqlite'), 'x'));
  assert.throws(() => lab.buildRelease('1.9.4', db, { baseline: '1.0.0' }), /must never be packaged/);
});

// ------------------------------------------------------------------ the success path
test('full-stack update: frontend + backend + migration, data preserved, trial pointer, every status reported', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('success');
  const before_ = totals(client.db);
  const { b, statuses } = lab.bootstrapFor(client);
  const result = await b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));

  assert.equal(result.ok, true, JSON.stringify(result));
  noDataLost(client, before_);
  assert.equal(hasColumn(client.db, 'orders', 'synthetic_note'), true);
  assert.equal(hasTable(client.db, 'synthetic_feature'), true);
  assert.deepEqual(statuses, ['VERIFYING', 'BACKUP_IN_PROGRESS', 'MIGRATING', 'INSTALLING', 'HEALTH_CHECK']);
  assert.deepEqual(statusesIn(client), statuses);

  const active = rel.readActive(client.dirs);
  assert.equal(active.version, '1.1.0');
  assert.equal(active.state, 'trial', 'not confirmed until the new version really started');
  assert.equal(rel.readJournal(client.dirs).phase, 'TRIAL');

  const dir = rel.releaseDir(client.dirs, '1.1.0');
  assert.ok(existsSync(join(dir, 'app', 'dist', 'synthetic-ui-change.js')));
  assert.ok(existsSync(join(dir, 'server', 'backend', 'app', 'Services', 'SyntheticNewService.php')));
  assert.ok(existsSync(join(client.installed.server, 'php', 'php.exe')), 'installed files are not touched');

  const trust = await rel.verifyReleaseForBoot(client.dirs, '1.1.0', lab.trusted);
  assert.equal(trust.ok, true, trust.problem);

  // Applying again changes nothing and repeats nothing: a migration never runs twice
  const again = await client.artisan(['foodcourt:update-db', 'apply', `--manifest=${lab.packageDir('1.1.0', 'incremental-1.0.0')}/manifest.json`, '--release=1.1.0'], join(dir, 'server'));
  const report = JSON.parse(again.trim().split('\n').pop());
  assert.equal(report.ok, true);
  assert.deepEqual(report.applied, []);
  assert.deepEqual(querySql(client.db, "select status from update_migration_ledger where migration_id='2030_01_01_000000_add_synthetic_note'"), [{ status: 'applied' }]);
  assert.ok(querySql(client.db, "select count(*) n from update_migration_ledger where status='adopted'")[0].n > 20, 'earlier migrations are recorded, not re-run');
});

test('recovery point holds the database, attachments, settings and key, each with a checksum', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('recovery-point');
  const { b } = lab.bootstrapFor(client);
  assert.equal((await b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'))).ok, true);
  const id = rel.readJournal(client.dirs).recovery_point;
  const dir = join(client.dirs.recovery, id);
  const verified = await recovery.verifyRecoveryPoint(dir);
  assert.equal(verified.ok, true, verified.error);
  for (const f of ['foodcourt.sqlite', 'snapshot.json', 'attachments/menu-images/dosa.jpg', 'config/server/app.key', 'config/userdata/desktop-settings.json']) assert.ok(verified.metadata.files[f], f);
  assert.equal(hasColumn(join(dir, 'foodcourt.sqlite'), 'orders', 'synthetic_note'), false, 'taken before the migration');

  // A damaged backup is recognised, so it can never be restored blindly
  const fd = openSync(join(dir, 'foodcourt.sqlite'), 'r+');
  writeSync(fd, Buffer.from('xxxx'), 0, 4, 200);
  closeSync(fd);
  const damaged = await recovery.verifyRecoveryPoint(dir);
  assert.equal(damaged.ok, false);
  assert.match(damaged.error, /damaged/);
  assert.equal((await recovery.restoreDatabase({ dir, dataDir: client.dataDir, userData: client.userData })).ok, false);
});

test('consecutive releases, and skipping a version with the full package', { skip, timeout: 300000 }, async () => {
  const v3 = lab.makeTree('v3', ({ appDir, serverDir, migrations }) => {
    writeFileSync(join(appDir, 'dist', 'synthetic-ui-change.js'), 'console.log("third")');
    writeFileSync(join(serverDir, 'backend', 'app', 'Services', 'SyntheticNewService.php'), '<?php\nnamespace App\\Services;\nclass SyntheticNewService { const V = 3; }\n');
    writeFileSync(join(migrations, '2030_01_01_000000_add_synthetic_note.php'), migrationSource(ADD_COLUMN));
    writeFileSync(join(migrations, '2030_02_01_000000_add_second.php'), migrationSource("Schema::create('synthetic_second', function (Blueprint $t) { $t->id(); });"));
  });
  lab.buildRelease('1.2.0', v3, { baseline: '1.1.0' });

  const consecutive = await freshClient('consecutive');
  const before_ = totals(consecutive.db);
  const first = lab.bootstrapFor(consecutive);
  assert.equal((await first.b.run(lab.jobFor(consecutive, '1.1.0', 'incremental-1.0.0'))).ok, true);
  rel.writeActive(consecutive.dirs, { ...rel.readActive(consecutive.dirs), state: 'confirmed' });
  rel.closeJournal(consecutive.dirs, rel.readJournal(consecutive.dirs), 'completed');

  const second = lab.bootstrapFor(consecutive);
  assert.equal((await second.b.run(lab.jobFor(consecutive, '1.2.0', 'incremental-1.1.0', { previous: '1.1.0' }))).ok, true);
  noDataLost(consecutive, before_);
  assert.equal(hasTable(consecutive.db, 'synthetic_second'), true);
  assert.equal(rel.readActive(consecutive.dirs).version, '1.2.0');
  assert.deepEqual(rel.readActive(consecutive.dirs).previous, { kind: 'release', version: '1.1.0' });
  assert.match(readFileSync(join(rel.releaseDir(consecutive.dirs, '1.2.0'), 'app', 'dist', 'synthetic-ui-change.js'), 'utf8'), /third/);

  // From 1.0.0 straight to 1.2.0: only the full package can do it, and it runs both migrations
  const skipping = await freshClient('skipping');
  const skipBefore = totals(skipping.db);
  const jump = lab.bootstrapFor(skipping);
  assert.equal((await jump.b.run(lab.jobFor(skipping, '1.2.0', 'full'))).ok, true);
  noDataLost(skipping, skipBefore);
  assert.equal(hasTable(skipping.db, 'synthetic_feature'), true);
  assert.equal(hasTable(skipping.db, 'synthetic_second'), true);
});

test('fresh install with no database yet: the update creates the schema', { skip, timeout: 240000 }, async () => {
  const client = lab.makeClient('fresh', v1, '1.0.0');
  const { b } = lab.bootstrapFor(client);
  const result = await b.run(lab.jobFor(client, '1.1.0', 'full'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(hasTable(client.db, 'orders'), true);
  assert.equal(hasColumn(client.db, 'orders', 'synthetic_note'), true);
});

// ------------------------------------------------------------------ refusing a bad package or install
test('incremental on a modified install is refused and full recovery works on it', { skip, timeout: 300000 }, async () => {
  const modified = lab.makeTree('v1-modified', ({ serverDir }) => writeFileSync(join(serverDir, 'backend', 'routes', 'api.php'), '<?php // locally changed'));
  const client = await freshClient('modified', modified);
  const before_ = totals(client.db);

  const manifest = JSON.parse(readFileSync(join(lab.packageDir('1.1.0', 'incremental-1.0.0'), 'manifest.json'), 'utf8'));
  const check = await rel.verifySource(manifest, rel.currentSource({ dirs: client.dirs, installed: client.installed }));
  assert.equal(check.ok, false);
  assert.ok(check.mismatches.includes('server/backend/routes/api.php'));

  const refused = lab.bootstrapFor(client);
  const result = await refused.b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));
  assert.equal(result.recovered, true);
  noDataLost(client, before_);
  assert.equal(hasColumn(client.db, 'orders', 'synthetic_note'), false);
  assert.equal(rel.readActive(client.dirs), null, 'still the installed version');
  assert.equal(outbox(client).find((x) => x.status === 'FAILED').details.needs_full, true);

  const full = lab.bootstrapFor(client);
  assert.equal((await full.b.run(lab.jobFor(client, '1.1.0', 'full'))).ok, true);
  noDataLost(client, before_);
  assert.equal(hasColumn(client.db, 'orders', 'synthetic_note'), true);
  assert.notEqual(readFileSync(join(rel.releaseDir(client.dirs, '1.1.0'), 'server', 'backend', 'routes', 'api.php'), 'utf8'), '<?php // locally changed', 'the full package repaired the file');
});

test('tampered package, tampered manifest, wrong version: stop before anything changes', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('tampered');
  const hash = await format.sha256File(client.db);

  const job = lab.jobFor(client, '1.1.0', 'incremental-1.0.0');
  const fd = openSync(job.payload_file, 'r+');
  writeSync(fd, Buffer.from('zz'), 0, 2, 10);
  closeSync(fd);
  const a = await lab.bootstrapFor(client).b.run(job);
  assert.equal(a.recovered, true);
  assert.match(a.failure, /SHA-256/);

  const job2 = lab.jobFor(client, '1.1.0', 'incremental-1.0.0');
  const editedManifest = join(client.home, 'edited.json');
  writeFileSync(editedManifest, readFileSync(job2.manifest_file, 'utf8').replace('"required":false', '"required":true'));
  const b2 = await lab.bootstrapFor(client).b.run({ ...job2, manifest_file: editedManifest });
  assert.equal(b2.recovered, true);
  assert.match(b2.failure, /signature/i);

  const b3 = await lab.bootstrapFor(client).b.run({ ...lab.jobFor(client, '1.1.0', 'incremental-1.0.0'), version: '9.9.9' });
  assert.equal(b3.recovered, true);

  assert.equal(await format.sha256File(client.db), hash, 'database file not even opened for writing');
  assert.equal(rel.readActive(client.dirs), null);
});

// ------------------------------------------------------------------ failures in the database
test('failing migration: rolled back, nothing further runs, no restore needed, previous version remains', { skip, timeout: 240000 }, async () => {
  buildVariant('2.0.1', { '2032_01_01_000000_fails': migrationSource("Schema::table('orders', function (Blueprint $t) { $t->string('half_done')->nullable(); });\n        if (DB::table('orders')->count() > 0) { throw new \\RuntimeException('synthetic failure'); }"), '2032_01_01_000001_never_runs': migrationSource("Schema::create('never_runs', function (Blueprint $t) { $t->id(); });") });
  const client = await freshClient('fail-migration');
  const before_ = totals(client.db);
  const { b, logs } = lab.bootstrapFor(client);
  const result = await b.run(lab.jobFor(client, '2.0.1', 'incremental-1.0.0'));

  assert.equal(result.ok, false);
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert.equal(result.restored_database, false, 'the transaction rolled back, so nothing needed restoring');
  assert.match(result.failure, /synthetic failure/);
  noDataLost(client, before_);
  assert.equal(hasColumn(client.db, 'orders', 'half_done'), false, 'rolled back');
  assert.equal(hasTable(client.db, 'never_runs'), false, 'nothing runs after a failure');
  assert.equal(rel.readActive(client.dirs), null);
  assert.equal(rel.readJournal(client.dirs), null, 'closed');
  assert.deepEqual(statusesIn(client).slice(-3), ['FAILED', 'RECOVERY_IN_PROGRESS', 'RECOVERED']);
  assert.ok(logs.some((l) => /Update stopped/.test(l)), 'kept in the log');
  assert.equal(querySql(client.db, "select count(*) n from update_migration_ledger where status in ('running','failed')")[0].n, 0, 'clean for the next try');
});

test('second of two migrations fails: database restored from the recovery point and verified', { skip, timeout: 240000 }, async () => {
  buildVariant('2.0.2', { '2033_01_01_000000_ok': migrationSource("Schema::create('first_ok', function (Blueprint $t) { $t->id(); });"), '2033_01_01_000001_fails': migrationSource("if (DB::table('orders')->count() > 0) { throw new \\RuntimeException('second fails'); }") });
  const client = await freshClient('fail-second');
  const before_ = totals(client.db);
  const result = await lab.bootstrapFor(client).b.run(lab.jobFor(client, '2.0.2', 'incremental-1.0.0'));
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert.equal(result.restored_database, true);
  assert.equal(result.database_verified, true);
  noDataLost(client, before_);
  assert.equal(hasTable(client.db, 'first_ok'), false, 'first migration was undone by the restore');
  const points = recovery.listRecoveryPoints(client.dirs.recovery);
  assert.equal(points.length, 1);
  assert.ok(readdirSync(join(client.dirs.recovery, points[0])).some((n) => n.startsWith('pre-restore-')), 'the failed state was kept for support');
  assert.ok(existsSync(join(client.dataDir, 'storage', 'app', 'menu-images', 'dosa.jpg')));
});

test('migration that deletes business data is caught by the totals comparison and undone', { skip, timeout: 240000 }, async () => {
  buildVariant('2.0.3', { '2034_01_01_000000_eats_orders': migrationSource("DB::statement('DELETE FROM orders WHERE id <= 5');", ' * @update-recovery: test only') }, { extra: ['--min-app-version', '2.0.3'] });
  const client = await freshClient('fail-data-loss');
  const before_ = totals(client.db);
  const result = await lab.bootstrapFor(client).b.run(lab.jobFor(client, '2.0.3', 'incremental-1.0.0'));
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert.equal(result.restored_database, true);
  assert.match(result.failure, /orders had 25 rows and now has 20/);
  noDataLost(client, before_);
  assert.deepEqual(querySql(client.db, "select count(*) n from update_db_state where key='min_app_version'"), [{ n: 0 }], 'the restore also removed the version floor');
});

test('schema that does not match the signed release is refused and undone', { skip, timeout: 240000 }, async () => {
  const tree = buildVariant('2.0.4', { '2035_01_01_000000_ok': migrationSource("Schema::create('schema_ok', function (Blueprint $t) { $t->id(); });") });
  const client = await freshClient('fail-schema');
  const before_ = totals(client.db);
  // A client whose orders table was altered by hand: the column type differs from what the release expects
  runSql(client.db, 'ALTER TABLE orders RENAME COLUMN notes TO notes_old; ALTER TABLE orders ADD COLUMN notes INTEGER;');
  const result = await lab.bootstrapFor(client).b.run(lab.jobFor(client, '2.0.4', 'incremental-1.0.0'));
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert.match(result.failure, /wrong type|does not match/);
  noDataLost(client, before_);
  assert.equal(hasTable(client.db, 'schema_ok'), false);
  void tree;
});

test('corrupted database: backup refuses it, migration never starts, file untouched', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('corrupt');
  const size = statSync(client.db).size;
  const fd = openSync(client.db, 'r+');
  writeSync(fd, Buffer.alloc(4096, 0x41), 0, 4096, 8192);
  closeSync(fd);
  const hash = await format.sha256File(client.db);
  const result = await lab.bootstrapFor(client).b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));
  assert.equal(result.ok, false);
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert.equal(await format.sha256File(client.db), hash, 'nothing wrote to it');
  assert.equal(statSync(client.db).size, size);
  assert.equal(recovery.listRecoveryPoints(client.dirs.recovery).length, 0, 'a bad backup is not kept as if it were good');
  assert.equal(rel.readActive(client.dirs), null);
});

test('low disk: stops before backing up anything', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('low-disk');
  const hash = await format.sha256File(client.db);
  const { b } = lab.bootstrapFor(client, { hooks: { statfs: async () => ({ bavail: 1, bsize: 4096 }) } });
  const result = await b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));
  assert.equal(result.recovered, true);
  assert.match(result.failure, /disk space/);
  assert.equal(await format.sha256File(client.db), hash);
  assert.equal(recovery.listRecoveryPoints(client.dirs.recovery).length, 0);
});

test('backup failure stops the update before any migration', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('backup-fail');
  const before_ = totals(client.db);
  // The recovery folder cannot be created because a file sits in its place
  writeFileSync(client.dirs.recovery, 'in the way');
  const { b } = lab.bootstrapFor(client, { hooks: { statfs: async () => ({ bavail: 1e9, bsize: 4096 }) } });
  const result = await b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));
  rmSync(client.dirs.recovery, { force: true });
  assert.equal(result.ok, false);
  assert.equal(hasColumn(client.db, 'orders', 'synthetic_note'), false, 'no migration ran');
  noDataLost(client, before_);
});

test('migration engine refuses bad checksums, unlisted and edited migrations before changing anything', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('engine-checks');
  const manifest = JSON.parse(readFileSync(join(lab.packageDir('1.1.0', 'full'), 'manifest.json'), 'utf8'));
  const write = (m, name) => {
    const f = join(client.home, name);
    writeFileSync(f, JSON.stringify(m));
    return f;
  };
  const apply = async (file) => {
    let out;
    try {
      out = await client.artisan(['foodcourt:update-db', 'apply', `--manifest=${file}`, '--release=1.1.0'], v2Tree.serverDir);
    } catch (err) {
      out = err.output;
    }
    return JSON.parse(String(out).trim().split('\n').pop());
  };

  const clone = () => JSON.parse(JSON.stringify(manifest));
  const badChecksum = clone();
  badChecksum.database.migrations.at(-1).sha256 = 'f'.repeat(64);
  let r = await apply(write(badChecksum, 'bad-checksum.json'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'preflight');
  assert.ok(r.problems.some((p) => /does not match its checksum/.test(p)));

  const unlisted = clone();
  unlisted.database.migrations = unlisted.database.migrations.slice(0, -1);
  r = await apply(write(unlisted, 'unlisted.json'));
  assert.ok(r.problems.some((p) => /not listed in the signed release/.test(p)));

  const missing = clone();
  missing.database.migrations.push({ id: '2099_missing', sha256: 'a'.repeat(64), depends_on: [] });
  r = await apply(write(missing, 'missing.json'));
  assert.ok(r.problems.some((p) => /file is missing/.test(p)));

  const twice = clone();
  twice.database.migrations.push(twice.database.migrations[0]);
  r = await apply(write(twice, 'twice.json'));
  assert.ok(r.problems.some((p) => /listed twice/.test(p)));

  const dependency = clone();
  dependency.database.migrations[0].depends_on = [dependency.database.migrations.at(-1).id];
  r = await apply(write(dependency, 'dep.json'));
  assert.ok(r.problems.some((p) => /comes later or is missing/.test(p)));

  assert.equal(hasColumn(client.db, 'orders', 'synthetic_note'), false, 'none of the above changed anything');

  // A migration recorded with other contents means this database has a different history
  assert.equal((await apply(write(clone(), 'good.json'))).ok, true);
  const edited = clone();
  edited.database.migrations[0].sha256 = '0'.repeat(64);
  r = await apply(write(edited, 'edited.json'));
  assert.equal(r.ok, false);
});

test('concurrent access: a second engine is locked out and the first is unaffected', { skip, timeout: 240000 }, async () => {
  const slow = buildVariant('2.0.5', { '2036_01_01_000000_slow': migrationSource("sleep(6);\n        Schema::create('slow_done', function (Blueprint $t) { $t->id(); });") });
  const client = await freshClient('concurrent');
  const manifestFile = join(lab.packageDir('2.0.5', 'incremental-1.0.0'), 'manifest.json');
  const run = async () => {
    let out;
    try {
      out = await client.artisan(['foodcourt:update-db', 'apply', `--manifest=${manifestFile}`, '--release=2.0.5'], slow.serverDir);
    } catch (err) {
      out = err.output;
    }
    return JSON.parse(String(out).trim().split('\n').pop());
  };
  const first = run();
  await new Promise((r) => setTimeout(r, 2500));
  const second = await run();
  assert.equal(second.ok, false);
  assert.equal(second.code, 'locked');
  assert.equal((await first).ok, true);
  assert.equal(hasTable(client.db, 'slow_done'), true);
  assert.equal(querySql(client.db, "select count(*) n from update_migration_ledger where migration_id='2036_01_01_000000_slow'")[0].n, 1);
});

const taskKillTree = (pid) => execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });

test('interrupted migration (process killed): detected on the next start, recovered, data intact', { skip, timeout: 300000 }, async () => {
  buildVariant('2.0.6', { '2037_01_01_000000_killed': migrationSource("Schema::table('orders', function (Blueprint $t) { $t->string('killed_col')->nullable(); });\n        if (DB::table('orders')->count() > 0) { sleep(60); }") });
  const client = await freshClient('killed');
  const before_ = totals(client.db);
  const job = lab.jobFor(client, '2.0.6', 'incremental-1.0.0');
  const script = join(lab.root, 'run-job.cjs');
  writeFileSync(script, `
    const { createBootstrap } = require(${JSON.stringify(join(DESKTOP, 'electron/update/bootstrap.cjs'))});
    const ctx = JSON.parse(process.argv[2]);
    createBootstrap({ ...ctx, log: () => undefined, onStatus: () => undefined }).run(ctx.job).then(() => process.exit(0));
  `);
  const child = spawn(process.execPath, [script, JSON.stringify({ dirs: client.dirs, dataDir: client.dataDir, userData: client.userData, installed: client.installed, trusted: lab.trusted, job })], { stdio: 'ignore' });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (hasTable(client.db, 'update_migration_ledger') && querySql(client.db, "select count(*) n from update_migration_ledger where status='running'")[0].n === 1) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(rel.readJournal(client.dirs).phase, 'MIGRATING');
  taskKillTree(child.pid);
  await new Promise((r) => setTimeout(r, 1500));

  // What the next start of the app decides, and what it then does
  const journal = rel.readJournal(client.dirs);
  assert.equal(rel.decideBoot({ journal, active: rel.readActive(client.dirs) }).action, 'recover');
  const result = await lab.bootstrapFor(client).b.recover(journal);
  assert.equal(result.recovered, true, JSON.stringify(result));
  noDataLost(client, before_);
  assert.equal(hasColumn(client.db, 'orders', 'killed_col'), false);
  assert.equal(querySql(client.db, 'select count(*) n from update_migration_ledger where status=\'running\'')[0].n, 0);
  assert.equal(outbox(client).some((x) => x.status === 'FAILED' && x.details?.code === 'interrupted'), true, 'reported as interrupted');
  assert.equal(rel.readJournal(client.dirs), null);
});

// ------------------------------------------------------------------ trial boot: the new version must prove itself
test('health check failure before the switch: previous version remains and the database is handled safely', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('health-fail');
  const before_ = totals(client.db);
  const { b } = lab.bootstrapFor(client, { hooks: { afterInstall: async () => rmSync(join(rel.releaseDir(client.dirs, '1.1.0'), 'server', 'backend', 'artisan')) } });
  const result = await b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));
  assert.equal(result.recovered, true, JSON.stringify(result));
  noDataLost(client, before_);
  assert.equal(rel.readActive(client.dirs), null);
  assert.equal(existsSync(rel.releaseDir(client.dirs, '1.1.0')), false, 'the broken release was removed');
});

test('trial boot never confirms: rolls back; additive schema stays because the old version runs on it', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('trial-rollback');
  const before_ = totals(client.db);
  const { b } = lab.bootstrapFor(client);
  assert.equal((await b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'))).ok, true);

  rel.writeActive(client.dirs, { ...rel.readActive(client.dirs), boot_attempts: rel.MAX_TRIAL_BOOTS });
  const journal = rel.readJournal(client.dirs);
  assert.equal(rel.decideBoot({ journal, active: rel.readActive(client.dirs) }).action, 'recover');

  const result = await lab.bootstrapFor(client).b.recover(journal);
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert.equal(result.restored_database, false, 'no restore was necessary');
  assert.equal(rel.readActive(client.dirs), null);
  noDataLost(client, before_);
  assert.equal(result.running_version, '1.0.0');
});

test('trial rollback with a destructive release restores, unless transactions arrived: then it stops for a developer', { skip, timeout: 300000 }, async () => {
  buildVariant('2.0.7', { '2038_01_01_000000_contract': migrationSource("Schema::table('orders', function (Blueprint $t) { $t->dropColumn('notes'); });", ' * @update-recovery: restore the recovery point') }, { extra: ['--min-app-version', '2.0.7'] });

  // Unchanged since migrating: restoring is proven safe
  const safe = await freshClient('trial-destructive-safe');
  const before_ = totals(safe.db);
  assert.equal((await lab.bootstrapFor(safe).b.run(lab.jobFor(safe, '2.0.7', 'incremental-1.0.0'))).ok, true, 'contract migration applied');
  assert.equal(hasColumn(safe.db, 'orders', 'notes'), false);
  const journal = rel.readJournal(safe.dirs);
  assert.equal(journal.backward_compatible, false);
  const restored = await lab.bootstrapFor(safe).b.recover(journal);
  assert.equal(restored.recovered, true, JSON.stringify(restored));
  assert.equal(restored.restored_database, true);
  assert.equal(hasColumn(safe.db, 'orders', 'notes'), true, 'the dropped column is back');
  noDataLost(safe, before_);

  // A new order appeared after migrating: restoring would lose it, so nothing is restored and a person must decide
  const unsafe = await freshClient('trial-destructive-unsafe');
  assert.equal((await lab.bootstrapFor(unsafe).b.run(lab.jobFor(unsafe, '2.0.7', 'incremental-1.0.0'))).ok, true);
  addOrders(unsafe.db, 1, 9000);
  const countWithNew = totals(unsafe.db).orders;
  const blocked = await lab.bootstrapFor(unsafe).b.recover(rel.readJournal(unsafe.dirs));
  assert.equal(blocked.needs_developer, true, JSON.stringify(blocked));
  assert.match(blocked.reason, /refused/);
  assert.equal(totals(unsafe.db).orders, countWithNew, 'the new transaction is still there');
  assert.equal(rel.decideBoot({ journal: rel.readJournal(unsafe.dirs), active: rel.readActive(unsafe.dirs) }).action, 'blocked', 'the app will not start on it');
  assert.equal(statusesIn(unsafe).at(-1), 'FAILED');
});

test('older program on a database with a version floor is refused at startup', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('version-floor');
  runSql(client.db, "CREATE TABLE IF NOT EXISTS update_db_state (key TEXT PRIMARY KEY, value TEXT); INSERT INTO update_db_state VALUES ('min_app_version','9.0.0');");
  const { startEmbeddedServer, locateRuntime } = await import('node:module').then((m) => m.createRequire(import.meta.url)(join(DESKTOP, 'electron/embedded-server.cjs')));
  process.env.FOODCOURT_MANAGED_RELEASE = '1';
  try {
    await assert.rejects(startEmbeddedServer({ runtime: locateRuntime(v1.serverDir), dataDir: client.dataDir, version: '1.0.0', log: () => undefined, onStatus: () => undefined }), (err) => err.code === 'schema_incompatible');
  } finally {
    delete process.env.FOODCOURT_MANAGED_RELEASE;
  }
  void createBootstrap;
  void copyFileSync;
  void mkdirSync;
});

test('managed release with a pending migration fails to start rather than migrating unverified', { skip, timeout: 240000 }, async () => {
  const pending = buildVariant('2.0.8', { '2039_01_01_000000_pending': migrationSource("Schema::create('should_not_exist', function (Blueprint $t) { $t->id(); });") });
  const client = await freshClient('pending');
  const { startEmbeddedServer, locateRuntime } = await import('node:module').then((m) => m.createRequire(import.meta.url)(join(DESKTOP, 'electron/embedded-server.cjs')));
  process.env.FOODCOURT_MANAGED_RELEASE = '1';
  try {
    await assert.rejects(startEmbeddedServer({ runtime: locateRuntime(pending.serverDir), dataDir: client.dataDir, version: '2.0.8', log: () => undefined, onStatus: () => undefined }), (err) => err.code === 'migration_failed');
  } finally {
    delete process.env.FOODCOURT_MANAGED_RELEASE;
  }
  assert.equal(hasTable(client.db, 'should_not_exist'), false);
});

test('a release modified on disk fails its boot verification', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('tamper-release');
  assert.equal((await lab.bootstrapFor(client).b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'))).ok, true);
  const dir = rel.releaseDir(client.dirs, '1.1.0');
  assert.equal((await rel.verifyReleaseForBoot(client.dirs, '1.1.0', lab.trusted)).ok, true);
  writeFileSync(join(dir, 'app', 'electron', 'main.cjs'), '// tampered');
  const r = await rel.verifyReleaseForBoot(client.dirs, '1.1.0', lab.trusted);
  assert.equal(r.ok, false);
  assert.equal((await rel.verifyReleaseForBoot(client.dirs, '1.1.0', {})).ok, false, 'no trust, no run');
});

// ------------------------------------------------------------------ scale and business integrity
test('large database: 300,000 orders migrate with all totals intact', { skip, timeout: 560000 }, async () => {
  const client = await freshClient('large');
  addOrders(client.db, 300000, 1000);
  const before_ = totals(client.db);
  const started = Date.now();
  const result = await lab.bootstrapFor(client).b.run(lab.jobFor(client, '1.1.0', 'incremental-1.0.0'));
  const seconds = (Date.now() - started) / 1000;
  assert.equal(result.ok, true, JSON.stringify(result));
  noDataLost(client, before_);
  console.log(`  large database: ${(statSync(client.db).size / 1048576).toFixed(0)} MB, ${before_.orders} orders, full update ${seconds.toFixed(1)} s`);
});

test('integrity snapshot sees every business total and detects each kind of change', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('snapshot');
  const take = async () => JSON.parse((await client.artisan(['foodcourt:update-db', 'snapshot'])).trim().split('\n').pop()).snapshot;
  const a = await take();
  assert.equal(a.integrity, 'ok');
  assert.equal(a.foreign_key_problems, 0);
  for (const t of ['orders', 'users', 'customers', 'suppliers', 'inventory_items', 'payments', 'stalls', 'daily_closings', 'purchase_orders', 'stock_movements', 'settlement_payouts']) assert.ok(t in a.counts, t);
  assert.ok('orders.total_amount' in a.totals);
  assert.ok('payments.amount' in a.totals);
  assert.ok('inventory_items.current_stock' in a.totals);
  assert.ok('stall_settlement_records.net_payable' in a.totals);
  assert.deepEqual(a.users_by_role, { cashier: 1, owner: 1 });
  assert.deepEqual(a.settings_keys, ['business_profile']);
  assert.equal(Object.keys(a.counts).some((t) => t.startsWith('update_')), false);

  const compare = async (mutate, pattern) => {
    runSql(client.db, mutate);
    const b = await take();
    const beforeFile = join(client.home, 'b.json');
    const afterFile = join(client.home, 'a.json');
    writeFileSync(beforeFile, JSON.stringify(a));
    writeFileSync(afterFile, JSON.stringify(b));
    let out;
    try {
      out = await client.artisan(['foodcourt:update-db', 'compare', `--before=${beforeFile}`, `--after=${afterFile}`]);
    } catch (err) {
      out = err.output;
    }
    const r = JSON.parse(String(out).trim().split('\n').pop());
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => pattern.test(p)), `${pattern}: ${r.problems}`);
  };
  await compare("UPDATE orders SET total_amount = total_amount + 1 WHERE id = 1", /orders\.total_amount changed/);
  await compare('UPDATE orders SET total_amount = total_amount - 1 WHERE id = 1; UPDATE inventory_items SET current_stock = 1', /inventory_items\.current_stock changed/);
  await compare('UPDATE inventory_items SET current_stock = 12.5; DELETE FROM customers', /customers had 1 rows/);
  await compare("INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (1,'Synthetic Customer','9000000001','2026-01-01','2026-01-01'); UPDATE users SET role='cashier' WHERE id=1", /accounts by role/);
  await compare("UPDATE users SET role='owner' WHERE id=1; DELETE FROM settings", /Settings were lost/);
});

test('recovery point retention never touches the newest points', { skip, timeout: 240000 }, async () => {
  const client = await freshClient('retention');
  const points = [];
  for (let i = 0; i < 4; i++) {
    const p = await recovery.createRecoveryPoint({ artisan: client.artisan, dataDir: client.dataDir, userData: client.userData, recoveryRoot: client.dirs.recovery, fromVersion: '1.0.0', toVersion: '1.1.0' });
    assert.equal(p.ok, true, p.error);
    points.push(p.id);
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.deepEqual(recovery.pruneRecoveryPoints(client.dirs.recovery, { keep: 3 }), [points[0]]);
  assert.deepEqual(recovery.listRecoveryPoints(client.dirs.recovery), points.slice(1));
});
