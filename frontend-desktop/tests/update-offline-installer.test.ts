// Real PHP, real SQLite, real signatures: the pen-drive route end to end, and the first start after an installer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { addOrders, createLab, DESKTOP, format, hasBuild, hasColumn, migrationSource, querySql, rel, totals } from './fixtures/update-lab.mjs';

const require = createRequire(import.meta.url);
const { createUpdateAgent } = require('../electron/update/agent.cjs');
const { artisanFor, locateRuntime, migrateInstalled, StartupError } = require('../electron/embedded-server.cjs');
const { parseReport } = require('../electron/backup.cjs');
const { evaluateMigrations } = await import('../scripts/release/lib.mjs');

const skip = hasBuild ? false : 'needs pnpm build and pnpm prepare:server';

/** The manifest prepare:server would write for this tree. */
function writeInstallerManifest(tree: { serverDir: string }) {
  const dir = join(tree.serverDir, 'backend', 'database', 'migrations');
  const files = readdirSync(dir).filter((n) => n.endsWith('.php')).map((n) => ({ path: `server/backend/database/migrations/${n}`, source: join(dir, n) }));
  const report = evaluateMigrations(files, null);
  const file = join(tree.serverDir, 'backend', 'database', 'migration-manifest.json');
  writeFileSync(file, JSON.stringify({ database: { engine: 'sqlite', migrations: report.migrations, expected_new_rows: report.expected_new_rows } }));
  return file;
}

function migrateWith(lab: ReturnType<typeof createLab>, client: { dataDir: string }, tree: { serverDir: string }, version: string) {
  const artisan = artisanFor(locateRuntime(tree.serverDir), client.dataDir);
  const artisanJson = async (args: string[]) => {
    let output;
    try {
      output = await artisan(args);
    } catch (err: any) {
      output = err && err.output;
    }
    return parseReport(output);
  };
  return migrateInstalled({ manifestFile: writeInstallerManifest(tree), dataDir: client.dataDir, version, artisanJson, log: () => undefined });
}

test('installer path: an older database upgrades through the engine, with a verified backup and the data intact', { skip, timeout: 240000 }, async () => {
  const lab = createLab();
  try {
    const before = lab.makeTree('old');
    const client = lab.makeClient('pc', before, '1.1.0');
    await lab.seedClient(client);
    addOrders(client.db, 25);
    const totalsBefore = totals(client.db);

    const after = lab.makeTree('new', ({ migrations }: { migrations: string }) => {
      writeFileSync(join(migrations, '2030_01_01_000000_add_note.php'), migrationSource("        Schema::table('orders', function (Blueprint $table) { $table->string('install_note')->nullable(); });"));
    });
    const result = await migrateWith(lab, client, after, '1.2.0');
    assert.equal(result.ran, true);
    assert.equal(hasColumn(client.db, 'orders', 'install_note'), true);
    assert.deepEqual(totals(client.db), totalsBefore, 'business data untouched');
    assert.ok(readdirSync(join(client.dataDir, 'backups')).some((n) => n.startsWith('foodcourt-before-install-1.2.0')), 'a backup exists');
    assert.ok(querySql(client.db, "select status from update_migration_ledger where migration_id like '%add_note'")[0].status === 'applied');
    assert.ok(querySql(client.db, "select count(*) n from update_migration_ledger where status='adopted'")[0].n > 0, 'earlier migrations recorded, never re-run');

    const again = await migrateWith(lab, client, after, '1.2.0');
    assert.equal(again.ran, false, 'the second start does nothing');
  } finally {
    lab.cleanup();
  }
});

test('installer path: a failing migration puts the database back and stops the start', { skip, timeout: 240000 }, async () => {
  const lab = createLab();
  try {
    const before = lab.makeTree('old');
    const client = lab.makeClient('pc', before, '1.1.0');
    await lab.seedClient(client);
    addOrders(client.db, 10);
    const totalsBefore = totals(client.db);

    const bad = lab.makeTree('bad', ({ migrations }: { migrations: string }) => {
      writeFileSync(join(migrations, '2030_01_01_000000_first.php'), migrationSource("        Schema::table('orders', function (Blueprint $table) { $table->string('kept_first')->nullable(); });"));
      writeFileSync(join(migrations, '2030_01_01_000001_second.php'), migrationSource("        throw new \\RuntimeException('deliberate failure');"));
    });
    await assert.rejects(() => migrateWith(lab, client, bad, '1.2.0'), (err: any) => err instanceof StartupError && err.code === 'migration_failed');

    assert.equal(hasColumn(client.db, 'orders', 'kept_first'), false, 'the first migration was undone as well');
    assert.deepEqual(totals(client.db), totalsBefore);
    const kept = readdirSync(join(client.dataDir, 'backups'));
    assert.ok(kept.some((n) => n.startsWith('foodcourt-failed-')), 'the failed copy is kept');
    assert.ok(kept.some((n) => n.startsWith('foodcourt-before-install-')), 'so is the backup');
    assert.equal(existsSync(join(client.dataDir, 'last-migration-manifest.txt')), false, 'it tries again next time');
  } finally {
    lab.cleanup();
  }
});

test('installer path: a migration that deletes business data is caught and undone', { skip, timeout: 240000 }, async () => {
  const lab = createLab();
  try {
    const before = lab.makeTree('old');
    const client = lab.makeClient('pc', before, '1.1.0');
    await lab.seedClient(client);
    addOrders(client.db, 10);
    const totalsBefore = totals(client.db);

    const bad = lab.makeTree('bad', ({ migrations }: { migrations: string }) => {
      writeFileSync(join(migrations, '2030_01_01_000000_loses.php'), migrationSource("        DB::table('orders')->where('id', '>', 5)->delete();"));
    });
    await assert.rejects(() => migrateWith(lab, client, bad, '1.2.0'), (err: any) => err instanceof StartupError);
    assert.deepEqual(totals(client.db), totalsBefore, 'all rows came back');
  } finally {
    lab.cleanup();
  }
});

test('installer path: a brand new install migrates from nothing', { skip, timeout: 240000 }, async () => {
  const lab = createLab();
  try {
    const tree = lab.makeTree('fresh');
    const client = lab.makeClient('pc', tree, '1.2.0');
    writeFileSync(client.db, '');
    assert.equal((await migrateWith(lab, client, tree, '1.2.0')).ran, true);
    assert.equal(querySql(client.db, 'select count(*) n from users')[0].n, 0, 'no accounts are created');
  } finally {
    lab.cleanup();
  }
});

test('pen drive end to end: release, export, verify, install, with the data and totals intact', { skip, timeout: 300000 }, async () => {
  const lab = createLab();
  try {
    const v1 = lab.makeTree('v1');
    lab.buildRelease('1.1.0', v1);
    const v2 = lab.makeTree('v2', ({ migrations, appDir }: { migrations: string; appDir: string }) => {
      writeFileSync(join(appDir, 'dist', 'pen-drive-marker.txt'), 'from the pen drive');
      writeFileSync(join(migrations, '2030_01_01_000000_add_pen.php'), migrationSource("        Schema::table('orders', function (Blueprint $table) { $table->string('pen_note')->nullable(); });"));
    });
    lab.buildRelease('1.2.0', v2, { baseline: '1.1.0' });

    const drive = join(lab.root, 'E');
    const exported = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/export-offline.mjs'), '--version', '1.2.0', '--store', lab.store, '--out', drive], { encoding: 'utf8' });
    assert.equal(exported.status, 0, exported.stderr);
    const folder = join(drive, 'MangalMurti-POS-Update-1.2.0');
    const refused = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/export-offline.mjs'), '--version', '1.2.0', '--store', lab.store, '--out', drive], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0, 'an export is never overwritten');

    const client = lab.makeClient('pc', v1, '1.1.0');
    await lab.seedClient(client);
    addOrders(client.db, 40);
    const totalsBefore = totals(client.db);

    // No network function is ever provided: anything that tried to use one would fail this test
    const agent = createUpdateAgent({
      dirs: client.dirs,
      trusted: () => lab.trusted,
      fetchImpl: async () => assert.fail('a pen-drive update must not use the network'),
      seal: (t: string) => Buffer.from(t),
      unseal: (b: Buffer) => b.toString(),
      getCurrentVersion: () => '1.1.0',
      getMode: () => 'embedded',
      getDataDir: () => client.dataDir,
      getServerUrl: () => '',
      electronMajor: 44,
      installed: () => client.installed,
      userIdleSeconds: () => 600,
      activity: { evaluate: async () => ({ idle: true, reasons: [] }) },
      now: () => new Date(2026, 10, 7, 3),
      startBootstrap: async () => undefined,
    });
    const prepared = await agent.prepareFromFolder(folder);
    assert.deepEqual(prepared, { ok: true, version: '1.2.0' });
    assert.equal((await agent.maintenanceTick()).installed, true, 'installs by itself once the PC is unused');

    const job = JSON.parse(readFileSync(join(client.dirs.state, 'job.json'), 'utf8'));
    assert.equal(job.target_id, null);
    assert.ok(statSync(job.payload_file).size > 0);
    const { b } = lab.bootstrapFor(client);
    const result = await b.run({ ...job, parent_pid: 0 });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(rel.readActive(client.dirs).version, '1.2.0');
    assert.equal(hasColumn(client.db, 'orders', 'pen_note'), true);
    assert.deepEqual(totals(client.db), totalsBefore);
    assert.equal(readFileSync(join(rel.releaseDir(client.dirs, '1.2.0'), 'app', 'dist', 'pen-drive-marker.txt'), 'utf8'), 'from the pen drive');
    assert.equal(existsSync(client.dirs.outbox), false, 'nothing queued for a server that does not exist');
    assert.equal(format.compareVersions(rel.readActive(client.dirs).version, '1.1.0'), 1);
  } finally {
    lab.cleanup();
  }
});

test('key rotation end to end: a release signed by a rotated-in key passes both agent and bootstrapper', { skip, timeout: 300000 }, async () => {
  const lab = createLab();
  const trust = require('../electron/update/trust.cjs');
  const { generateKeyPairSync } = await import('node:crypto');
  const pair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, pub: Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64') };
  };
  try {
    const root = pair();
    const fresh = pair();
    const installedFile = join(lab.root, 'update-trust.json');
    writeFileSync(installedFile, JSON.stringify({ root: { r1: root.pub }, keys: { old: fresh.pub.replace(/^./, 'A') } }));
    const keyFile = join(lab.root, 'new-signing.pem');
    writeFileSync(keyFile, fresh.pem);

    const v1 = lab.makeTree('v1');
    lab.buildRelease('1.1.0', v1);
    const v2 = lab.makeTree('v2', ({ appDir }: { appDir: string }) => writeFileSync(join(appDir, 'dist', 'rotated.txt'), 'x'));
    const built = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/build-release.mjs'), '--version', '1.2.0', '--store', lab.store, '--app-root', v2.appDir, '--server-root', v2.serverDir, '--key', keyFile, '--key-id', 'new', '--electron-major', '44'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(built.status, 0, built.stderr);

    const client = lab.makeClient('pc', v1, '1.1.0');
    await lab.seedClient(client);
    const resolved = () => trust.resolveTrust(installedFile, client.dirs.trustStatement);
    const raw = readFileSync(lab.packageDir('1.2.0', 'full') + '/manifest.json', 'utf8');
    const sig = readFileSync(lab.packageDir('1.2.0', 'full') + '/manifest.sig', 'utf8');
    assert.equal(rel.loadManifest(raw, sig, 'new', resolved()).ok, false, 'not trusted yet');

    const statementRaw = JSON.stringify({ version: 2, keys: { new: fresh.pub }, retired: ['old'], issued_at: 'x' });
    const applied = trust.applyStatement({ installedFile, statementFile: client.dirs.trustStatement, raw: statementRaw, signature: format.signManifest(statementRaw, root.pem), keyId: 'r1' });
    assert.equal(applied.ok, true);
    assert.equal(rel.loadManifest(raw, sig, 'new', resolved()).ok, true, 'the agent now trusts it');

    const job = lab.jobFor(client, '1.2.0', 'full');
    const { createBootstrap } = require('../electron/update/bootstrap.cjs');
    const b = createBootstrap({ dirs: client.dirs, dataDir: client.dataDir, userData: client.userData, installed: client.installed, trusted: resolved(), log: () => undefined });
    const result = await b.run(job);
    assert.equal(result.ok, true, `and so does the bootstrapper: ${JSON.stringify(result)}`);
  } finally {
    lab.cleanup();
  }
});
