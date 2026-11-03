/**
 * Unit tests for the automatic-startup, backup and multi-PC pairing logic that has no Electron dependency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeLoginError } from '../src/lib/apiErrors.ts';

const require = createRequire(import.meta.url);
const server = require('../electron/embedded-server.cjs');
const backup = require('../electron/backup.cjs');
const pairing = require('../electron/pairing.cjs');

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ------------------------------------------------------------------ failure wording
test('every startup failure message is plain language: no addresses, ports, paths or product names', () => {
  for (const [code, text] of Object.entries(server.FAILURE) as [string, string][]) {
    assert.doesNotMatch(text, /localhost|127\.0\.0\.1|port|https?:|api|laravel|php|postgres|sqlite|artisan|[A-Z]:\\/i, `${code}: ${text}`);
    assert.ok(text.length > 40, code);
  }
  const err = new server.StartupError('database_unavailable', 'SQLSTATE[HY000]: unable to open database file C:\\Users\\x');
  assert.equal(err.message, server.FAILURE.database_unavailable);
  assert.match(err.detail, /SQLSTATE/, 'technical detail is kept for the log only');
});

test('a failed migration is told apart from an unreadable database', () => {
  assert.equal(server.classifyMigrationFailure('SQLSTATE[HY000]: General error: 11 database disk image is malformed'), 'database_unavailable');
  assert.equal(server.classifyMigrationFailure('unable to open database file'), 'database_unavailable');
  assert.equal(server.classifyMigrationFailure('Syntax error in migration 2026_11_03'), 'migration_failed');
});

// ------------------------------------------------------------------ process ownership
test('only a PHP started by this app for this data folder counts as ours', () => {
  const data = 'C:\\Users\\Asha\\AppData\\Roaming\\FoodCourt Desktop\\server';
  const ours = `"C:\\app\\server\\php\\php.exe" -n -d error_log=${data}\\logs\\php-error.log -S 127.0.0.1:5000 -t C:\\app\\public router.php`;
  assert.equal(server.isOurProcess(ours, data), true);
  assert.equal(server.isOurProcess('"C:\\xampp\\php\\php.exe" -S 127.0.0.1:8000 -t C:\\xampp\\htdocs', data), false, "someone else's PHP dev server");
  assert.equal(server.isOurProcess('"C:\\Windows\\notepad.exe" ' + data, data), false, 'not PHP');
  assert.equal(server.isOurProcess('', data), false);
});

test('a stale pid file never causes an unrelated process to be touched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-pid-'));
  const logs: string[] = [];
  try {
    const killed: number[] = [];
    const realKill = process.kill;
    (process as any).kill = (pid: number) => killed.push(pid);
    try {
      writeFileSync(join(dir, 'server.pid'), JSON.stringify({ pid: 4242, port: 1 }));
      assert.equal(await server.reclaimOrphan(dir, (_l: string, m: string) => logs.push(m), async () => ''), false, 'process already gone');
      assert.equal(existsSync(join(dir, 'server.pid')), false, 'stale record removed');

      writeFileSync(join(dir, 'server.pid'), JSON.stringify({ pid: 4243, port: 1 }));
      assert.equal(await server.reclaimOrphan(dir, (_l: string, m: string) => logs.push(m), async () => '"C:\\other\\php.exe" -S 127.0.0.1:80'), false, 'another PHP');
      assert.deepEqual(killed, [], 'nothing was stopped');

      writeFileSync(join(dir, 'server.pid'), JSON.stringify({ pid: 4244, port: 1 }));
      assert.equal(await server.reclaimOrphan(dir, (_l: string, m: string) => logs.push(m), async () => `"php.exe" -d error_log=${dir}\\logs\\x -S 127.0.0.1:1`), true);
      assert.deepEqual(killed, [4244]);

      assert.equal(await server.reclaimOrphan(dir, () => undefined, async () => 'x'), false, 'no pid file: nothing to do');
      writeFileSync(join(dir, 'server.pid'), 'not json');
      assert.equal(await server.reclaimOrphan(dir, () => undefined, async () => 'x'), false, 'garbage pid file is ignored');
    } finally {
      (process as any).kill = realKill;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ backups
test('backup file names sort by time and name their kind', () => {
  const a = backup.backupFileName('auto', new Date('2026-11-03T10:00:00Z'));
  const b = backup.backupFileName('manual', new Date('2026-11-04T10:00:00Z'));
  assert.match(a, /^foodcourt-auto-2026-11-03T10-00-00-000Z\.sqlite$/);
  assert.match(b, /^foodcourt-manual-/);
});

test('only automatic backups beyond the newest 14 are pruned; manual and safety copies never', () => {
  const names: string[] = [];
  for (let d = 1; d <= 20; d++) names.push(`foodcourt-auto-2026-10-${String(d).padStart(2, '0')}T00-00-00-000Z.sqlite`);
  names.push('foodcourt-manual-2026-01-01T00-00-00-000Z.sqlite', 'foodcourt-before-restore-2026-01-01T00-00-00-000Z.sqlite', 'foodcourt-before-1.1.0-x.sqlite', 'notes.txt');
  const pruned = backup.selectToPrune(names);
  assert.equal(pruned.length, 6);
  assert.ok(pruned.every((n: string) => n.startsWith('foodcourt-auto-')));
  assert.equal(pruned[0], 'foodcourt-auto-2026-10-01T00-00-00-000Z.sqlite', 'oldest first');
  assert.ok(!pruned.includes('foodcourt-auto-2026-10-20T00-00-00-000Z.sqlite'));
});

test('the API report is found among other output, and bad output is not trusted', () => {
  assert.deepEqual(backup.parseReport('warning\n{"ok":true,"bytes":10}\n'), { ok: true, bytes: 10 });
  assert.equal(backup.parseReport('PHP Fatal error: boom'), null);
  assert.equal(backup.parseReport(''), null);
  assert.equal(backup.parseReport('{broken json}'), null);
});

test('an automatic backup is due when none succeeded in the last 24 hours', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(backup.autoBackupDue(null, now), true);
  assert.equal(backup.autoBackupDue('garbage', now), true);
  assert.equal(backup.autoBackupDue('2026-11-03T00:00:01Z', now), false);
  assert.equal(backup.autoBackupDue('2026-11-02T11:59:00Z', now), true);
});

test('a backup failure reported by the API is never counted as success, and leaves no half file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-bk-'));
  try {
    const logs: string[] = [];
    const log = (_l: string, m: string) => logs.push(m);
    const bad = await backup.createBackup({
      dir, kind: 'manual', log,
      artisan: async (args: string[]) => {
        writeFileSync(args[1], 'half written');
        return '{"ok":false,"problems":["The database file is damaged."]}';
      },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'The database file is damaged.');
    assert.equal(readdirSync(dir).length, 0, 'the unverified file was removed');

    const crashed = await backup.createBackup({ dir, kind: 'manual', log, artisan: async () => { throw Object.assign(new Error('exit 255'), { output: 'PHP Fatal error' }); } });
    assert.equal(crashed.ok, false);

    const good = await backup.createBackup({
      dir, kind: 'manual', log,
      artisan: async (args: string[]) => {
        writeFileSync(args[1], 'data');
        return 'noise\n{"ok":true,"bytes":4,"users":2}';
      },
    });
    assert.equal(good.ok, true);
    assert.equal(readdirSync(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unwritable backup folder is refused before anything runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-bk-'));
  try {
    const file = join(dir, 'a-file-not-a-folder');
    writeFileSync(file, 'x');
    let ran = false;
    const r = await backup.createBackup({ dir: file, kind: 'manual', log: () => undefined, artisan: async () => { ran = true; return ''; } });
    assert.equal(r.ok, false);
    assert.equal(ran, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restoring keeps a copy of the current data and can be rolled back', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-rs-'));
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir);
  try {
    writeFileSync(join(dataDir, 'foodcourt.sqlite'), 'CURRENT');
    writeFileSync(join(dataDir, 'foodcourt.sqlite-wal'), 'stale wal');
    writeFileSync(join(dataDir, 'incoming.sqlite'), 'FROM-BACKUP');

    const safety = backup.swapDatabase({ dataDir, backupDir, source: join(dataDir, 'incoming.sqlite') });
    assert.equal(readFileSync(join(dataDir, 'foodcourt.sqlite'), 'utf8'), 'FROM-BACKUP');
    assert.equal(readFileSync(safety, 'utf8'), 'CURRENT', 'the replaced data is kept');
    assert.equal(existsSync(join(dataDir, 'foodcourt.sqlite-wal')), false, 'leftover journal of the old file is gone');
    assert.match(safety, /foodcourt-before-restore-/);

    backup.rollbackDatabase({ dataDir, safety });
    assert.equal(readFileSync(join(dataDir, 'foodcourt.sqlite'), 'utf8'), 'CURRENT');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ pairing
test('a connection code from the owner is decoded; the address and code come out validated', () => {
  const str = `FCPAIR1.${b64url({ u: 'https://foodcourt-host.lan/api', c: 'abcd-2345' })}`;
  assert.deepEqual(pairing.decodePairingString(`  ${str}\n`), { ok: true, url: 'https://foodcourt-host.lan/api', code: 'ABCD-2345' });
});

test('damaged, foreign or hostile connection codes are rejected', () => {
  const bad = [
    '', 'hello', 'FCPAIR1.', 'FCPAIR1.%%%', `FCPAIR1.${b64url({ c: 'ABCD-2345' })}`,
    `FCPAIR1.${b64url({ u: 'ftp://host/api', c: 'ABCD-2345' })}`,
    `FCPAIR1.${b64url({ u: 'https://user:pw@host/api', c: 'ABCD-2345' })}`,
    `FCPAIR1.${b64url({ u: 'https://host/api', c: 'short' })}`,
    `FCPAIR1.${b64url({ u: 'https://host/notapi', c: 'ABCD-2345' })}`,
    `FCPAIR1.${'A'.repeat(900)}`,
  ];
  for (const input of bad) assert.equal(pairing.decodePairingString(input).ok, false, input.slice(0, 40));
});

test('plain http is accepted only on this PC or a private network, never across the internet', () => {
  assert.equal(pairing.hostIsSafe('https://shop.example.com/api').ok, true);
  assert.equal(pairing.hostIsSafe('http://192.168.1.20:8000/api').ok, true);
  assert.equal(pairing.hostIsSafe('http://foodcourt-host/api').ok, true);
  assert.equal(pairing.hostIsSafe('http://shop.example.com/api').ok, false);
  assert.equal(pairing.hostIsSafe('http://203.0.113.9/api').ok, false);
});

test('the device token is attached only to requests for the paired host', () => {
  const host = 'https://foodcourt-host.lan:8443/api';
  assert.equal(pairing.shouldAttachDeviceToken('https://foodcourt-host.lan:8443/api/orders', host), true);
  assert.equal(pairing.shouldAttachDeviceToken('https://evil.example.com/api/orders', host), false);
  assert.equal(pairing.shouldAttachDeviceToken('http://foodcourt-host.lan:8443/api/orders', host), false, 'different scheme is a different origin');
  assert.equal(pairing.shouldAttachDeviceToken('https://foodcourt-host.lan:9999/x', host), false);
  assert.equal(pairing.shouldAttachDeviceToken('not a url', host), false);
});

test('host refusals are explained in words the staff can act on', () => {
  assert.match(pairing.describeRedeemFailure(422), /new one/);
  assert.match(pairing.describeRedeemFailure(404), /not a shared/);
  assert.match(pairing.describeRedeemFailure(429), /Wait a minute/);
});

test('an old hand-typed "this computer" address no longer traps an upgraded PC; real hosts and pairings are kept', () => {
  const { shouldUseSavedAddress } = require('../electron/config.cjs');
  assert.equal(shouldUseSavedAddress('http://127.0.0.1:8000/api', false), false, '1.0.x default/typed loopback: use the built-in database');
  assert.equal(shouldUseSavedAddress('http://localhost:8100/api', false), false);
  assert.equal(shouldUseSavedAddress('http://127.0.0.1:8000/api', true), true, 'a deliberate pairing is honoured');
  assert.equal(shouldUseSavedAddress('http://192.168.1.20/api', false), true, 'a legacy LAN server address is kept');
  assert.equal(shouldUseSavedAddress('https://shop.example.com/api', false), true);
  assert.equal(shouldUseSavedAddress('garbage', true), false);
});

// ------------------------------------------------------------------ sign-in messages
test('the server names the three situations that need a different action', () => {
  assert.equal(describeLoginError({ response: { status: 422, data: { code: 'setup_required', message: 'x', errors: { email: ['x'] } } } }).kind, 'setup_required');
  assert.equal(describeLoginError({ response: { status: 422, data: { code: 'owner_missing', message: 'x' } } }).kind, 'owner_missing');
  assert.equal(describeLoginError({ response: { status: 403, data: { code: 'device_not_paired', message: 'ask the owner' } } }).kind, 'device_not_paired');
  assert.equal(describeLoginError({ response: { status: 422, data: { errors: { email: ['The provided credentials do not match our records.'] } } } }).message, 'Invalid email or password.');
});

test('no sign-in message mentions server addresses or settings', () => {
  const samples = [
    describeLoginError({ code: 'API_NOT_CONFIGURED' }),
    describeLoginError({ message: 'Network Error' }),
    describeLoginError({ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' }),
    describeLoginError({ response: { status: 404, data: {} } }),
    describeLoginError({ response: { status: 500, data: {} } }),
  ];
  for (const s of samples) assert.doesNotMatch(s.message, /address|settings|api|\/api|laravel|HTTP \d/i, s.message);
});
