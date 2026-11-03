/**
 * Integration tests of the single-PC lifecycle against the REAL bundled PHP runtime and Laravel API
 * (frontend-desktop/build-server), each in its own throw-away data folder. Nothing here touches a real
 * installation's data (%APPDATA%) or any PostgreSQL database.
 *
 *   cd frontend-desktop && pnpm prepare:server   # once, to (re)build build-server
 *   node --test --test-timeout=240000 ../qa/desktop/lifecycle.e2e.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend-desktop');
const es = require(join(ROOT, 'electron', 'embedded-server.cjs'));
const backup = require(join(ROOT, 'electron', 'backup.cjs'));
const runtime = es.locateRuntime(join(ROOT, 'build-server'));
assert.ok(runtime, 'build-server is missing: run `pnpm prepare:server` in frontend-desktop first');

const STRONG = 'Str0ngPass99';
const dirs = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'fc-life-'));
  dirs.push(d);
  return d;
};
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const logs = [];
const log = (level, msg) => logs.push(`${level} ${msg}`);
const start = (dir, version = '1.1.0', extra = {}) => {
  const phases = [];
  const p = es.startEmbeddedServer({ runtime, dataDir: dir, version, log, onStatus: (s) => phases.push(s.phase), ...extra });
  return p.then((s) => Object.assign(s, { phases }));
};

const call = async (server, method, path, body, token) => {
  const res = await fetch(server.url + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no body
  }
  return { status: res.status, json };
};

const phpSql = (dir, sql) =>
  execFileSync(runtime.php, [...es.phpArgs(runtime, dir), '-r', `$p=new PDO('sqlite:'.$argv[1]);$r=$p->exec($argv[2]);echo $r;`, '--', join(dir, 'foodcourt.sqlite'), sql], { encoding: 'utf8' });

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (fn, ms = 30000, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
};
const setupOwner = (server, email = 'asha@example.com') => call(server, 'POST', '/setup/owner', { name: 'Asha Patil', email, password: STRONG });

// ------------------------------------------------------------------ startup
test('fresh installation: starts by itself, reports each step, and asks for the owner setup', async () => {
  const dir = fresh();
  const s = await start(dir);
  try {
    assert.deepEqual(s.phases.filter((p, i, a) => a.indexOf(p) === i), ['starting', 'preparing_database', 'connecting', 'ready'], 'plain startup steps in order');
    assert.equal(s.status().phase, 'ready');
    assert.equal(s.status().setup, 'needed');

    const ready = await fetch(s.url + '/system/ready').then((r) => r.json());
    assert.equal(ready.data.database, true);
    assert.equal(ready.data.migrations_current, true);
    assert.equal(ready.data.setup, 'needed');
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/up`)).status, 200);

    const r = await call(s, 'POST', '/auth/login', { email: 'owner@foodcourt.com', password: 'password123' });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'setup_required', 'a missing owner account is reported as such, not as a wrong password');
    assert.doesNotMatch(JSON.stringify(r.json), /sql|sqlite|vendor|[A-Z]:\\\\/i, 'no internal detail reaches the client');
  } finally {
    await s.stop();
  }
});

test('first-run setup, then every sign-in outcome, logout and a restart', async () => {
  const dir = fresh();
  let s = await start(dir);
  try {
    const weak = await call(s, 'POST', '/setup/owner', { name: 'A', email: 'a@example.com', password: 'short' });
    assert.equal(weak.status, 422, 'weak password refused');

    const made = await setupOwner(s);
    assert.equal(made.status, 201);
    assert.match(made.json.data.recovery_key, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/);
    assert.equal((await setupOwner(s, 'intruder@example.com')).status, 409, 'setup runs once only');

    const ok = await call(s, 'POST', '/auth/login', { email: 'Asha@Example.com', password: STRONG });
    assert.equal(ok.status, 200, 'valid owner login (capital letters in the email do not matter)');
    const token = ok.json.data.token;
    assert.equal((await call(s, 'GET', '/auth/me', null, token)).status, 200);

    const wrong = await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: 'Wrong-pass-1' });
    const unknown = await call(s, 'POST', '/auth/login', { email: 'nobody@example.com', password: 'Wrong-pass-1' });
    assert.equal(wrong.status, 422);
    assert.deepEqual(unknown.json.errors, wrong.json.errors, 'wrong password and unknown email are indistinguishable (no account probing)');

    const out = await call(s, 'POST', '/auth/logout', null, token);
    assert.equal(out.status, 200);
    assert.equal((await call(s, 'GET', '/auth/me', null, token)).status, 401, 'a signed-out (revoked) session is rejected');

    // Restart: nothing lost, no second setup, sign-in still works
    await s.stop();
    s = await start(dir);
    assert.equal(s.status().setup, 'complete');
    assert.equal((await setupOwner(s, 'again@example.com')).status, 409);
    assert.equal((await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).status, 200);
  } finally {
    await s.stop();
  }
});

test('a deleted owner is not silently recreated; the recovery key restores access', async () => {
  const dir = fresh();
  let s = await start(dir);
  try {
    const key = (await setupOwner(s)).json.data.recovery_key;
    await s.stop();
    phpSql(dir, 'delete from personal_access_tokens; delete from users;');
    s = await start(dir);
    assert.equal(s.status().setup, 'recovery_required');

    assert.equal((await setupOwner(s, 'intruder@example.com')).status, 409, 'first-run setup does not come back');
    const login = await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG });
    assert.equal(login.json.code, 'owner_missing');

    const bad = await call(s, 'POST', '/setup/recover', { email: 'asha@example.com', name: 'Asha', recovery_key: 'AAAA-BBBB-CCCC-DDDD-EEEE', password: 'N3wPassword77' });
    assert.equal(bad.status, 422);
    const good = await call(s, 'POST', '/setup/recover', { email: 'asha@example.com', name: 'Asha', recovery_key: key, password: 'N3wPassword77' });
    assert.equal(good.status, 200);
    assert.equal((await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: 'N3wPassword77' })).status, 200);
  } finally {
    await s.stop();
  }
});

// ------------------------------------------------------------------ process lifecycle
test('unexpected shutdown: the built-in server is restarted by itself on the same address', async () => {
  const dir = fresh();
  const s = await start(dir);
  try {
    await setupOwner(s);
    const { pid, port } = JSON.parse(readFileSync(join(dir, 'server.pid'), 'utf8'));
    assert.equal(port, s.port);
    process.kill(pid); // simulate a crash

    assert.ok(await until(() => s.status().phase === 'degraded' || s.status().phase === 'ready' ? true : false, 10000), 'a problem is noticed');
    const back = await until(async () => {
      const r = await fetch(`http://127.0.0.1:${s.port}/up`).catch(() => null);
      return r && r.status === 200 && s.status().phase === 'ready';
    }, 40000);
    assert.ok(back, 'service came back by itself');
    assert.equal((await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).status, 200, 'data intact after the restart');
  } finally {
    await s.stop();
  }
});

test('a server left behind by a crashed app is reclaimed, and an unrelated PHP is left alone', async () => {
  const dir = fresh();
  // an unrelated PHP dev server that must survive everything below
  const otherPort = await new Promise((res) => {
    const t = net.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  const other = spawn(runtime.php, ['-n', '-S', `127.0.0.1:${otherPort}`, '-t', tmpdir()], { stdio: 'ignore', windowsHide: true });
  // the "previous run": a built-in server that outlived its app (detached, so Windows does not reap it), with the pid
  // record the app writes. Same command line the app uses for its own server.
  const orphanPort = await new Promise((res) => {
    const t = net.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  for (const d of ['logs', 'tmp', 'cache', 'storage/framework/cache/data', 'storage/framework/views', 'storage/logs', 'storage/app/public']) mkdirSync(join(dir, d), { recursive: true });
  const old = spawn(runtime.php, [...es.phpArgs(runtime, dir), '-S', `127.0.0.1:${orphanPort}`, '-t', join(runtime.backendDir, 'public'), runtime.router], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true });
  old.unref();
  writeFileSync(join(dir, 'server.pid'), JSON.stringify({ pid: old.pid, port: orphanPort, startedAt: new Date().toISOString() }));
  try {
    const orphan = { pid: old.pid, port: orphanPort };
    await until(async () => pidAlive(orphan.pid), 10000);
    assert.ok(pidAlive(orphan.pid), 'precondition: the old server is running and holds the data folder');

    const s = await start(dir);
    try {
      assert.equal(pidAlive(orphan.pid), false, 'the leftover built-in server was stopped');
      assert.ok(pidAlive(other.pid), "someone else's PHP was not touched");
      assert.equal((await fetch(`http://127.0.0.1:${s.port}/up`)).status, 200);
      assert.ok(logs.some((l) => /left behind by a previous run/.test(l)));
    } finally {
      await s.stop();
    }
  } finally {
    try { process.kill(old.pid); } catch { /* already gone */ }
    other.kill();
  }
});

test('occupied port: the next free port is used instead', async () => {
  const dir = fresh();
  const squatter = net.createServer();
  const taken = await new Promise((res) => squatter.listen(0, '127.0.0.1', () => res(squatter.address().port)));
  let free;
  try {
    free = await new Promise((res) => {
      const t = net.createServer().listen(0, '127.0.0.1', () => {
        const p = t.address().port;
        t.close(() => res(p));
      });
    });
    const tried = [];
    const s = await start(dir, '1.1.0', { portFinder: async (attempt) => { const p = attempt === 1 ? taken : free; tried.push(p); return p; } });
    try {
      assert.deepEqual(tried, [taken, free], 'first port was busy, second was used');
      assert.equal(s.port, free);
      assert.equal(s.status().phase, 'ready');
    } finally {
      await s.stop();
    }
  } finally {
    squatter.close();
  }
});

// ------------------------------------------------------------------ database problems and upgrades
test('database unavailable: a damaged database is reported in plain words and left untouched', async () => {
  const dir = fresh();
  const garbage = Buffer.from('this is not an sqlite database '.repeat(300));
  writeFileSync(join(dir, 'foodcourt.sqlite'), garbage);
  const phases = [];
  await assert.rejects(
    es.startEmbeddedServer({ runtime, dataDir: dir, version: '1.1.0', log, onStatus: (s) => phases.push(s) }),
    (err) => {
      assert.equal(err.code, 'database_unavailable');
      assert.equal(err.message, es.FAILURE.database_unavailable, 'the screen text is the safe message');
      assert.match(err.detail, /malformed|not a database|unable to open/i, 'the technical reason is kept for the log');
      return true;
    }
  );
  assert.equal(phases.at(-1).phase, 'failed');
  assert.deepEqual(readFileSync(join(dir, 'foodcourt.sqlite')), garbage, 'the damaged file was not modified or replaced');
  assert.equal(existsSync(join(dir, 'server.pid')) && pidAlive(JSON.parse(readFileSync(join(dir, 'server.pid'), 'utf8')).pid), false, 'no server left running');
});

test('upgrade keeps all data and copies the database aside first', async () => {
  const dir = fresh();
  let s = await start(dir, '1.0.2');
  const key = (await setupOwner(s)).json.data.recovery_key;
  const token = (await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
  const stall = await call(s, 'POST', '/stalls', { name: 'Pizza Corner', code: 'PIZ', is_active: true }, token);
  await s.stop();
  assert.ok([200, 201].includes(stall.status), JSON.stringify(stall.json));

  s = await start(dir, '1.1.0');
  try {
    const copies = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('foodcourt-before-1.1.0-'));
    assert.equal(copies.length, 1, 'a copy of the old data was made before the new version first ran');
    const t2 = (await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
    const stalls = await call(s, 'GET', '/stalls', null, t2);
    assert.ok(JSON.stringify(stalls.json).includes('Pizza Corner'), 'business data survived the upgrade');
    assert.ok(key);
  } finally {
    await s.stop();
  }
});

// ------------------------------------------------------------------ backup and restore
test('backup is verified, and restoring it into a separate empty environment brings the data back', async () => {
  const dir = fresh();
  const outDir = fresh();
  let s = await start(dir);
  let target;
  try {
    await setupOwner(s);
    const token = (await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
    await call(s, 'POST', '/stalls', { name: 'Burger Hub', code: 'BUR', is_active: true }, token);

    const made = await backup.createBackup({ artisan: s.artisan, dir: outDir, kind: 'manual', log });
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.report.integrity, 'ok');
    assert.equal(made.report.users, 1);
    target = made.file;

    await call(s, 'POST', '/stalls', { name: 'Added After Backup', code: 'AFT', is_active: true }, token);
  } finally {
    await s.stop();
  }

  // Isolated environment: a brand-new data folder that has never seen the original
  const isolated = fresh();
  copyFileSync(target, join(isolated, 'foodcourt.sqlite'));
  const r = await start(isolated);
  try {
    assert.equal(r.status().setup, 'complete');
    const t = (await call(r, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
    const body = JSON.stringify((await call(r, 'GET', '/stalls', null, t)).json);
    assert.ok(body.includes('Burger Hub'), 'data in the backup is restored');
    assert.ok(!body.includes('Added After Backup'), 'later changes are not in the backup');
  } finally {
    await r.stop();
  }
});

test('a damaged or empty backup file is rejected before it can replace anything', async () => {
  const dir = fresh();
  const s = await start(dir);
  try {
    await setupOwner(s);
    const bad = join(fresh(), 'foodcourt-manual-bad.sqlite');
    writeFileSync(bad, Buffer.from('garbage '.repeat(500)));
    const r1 = await backup.verifyBackup({ artisan: s.artisan, file: bad });
    assert.equal(r1.ok, false);
    const empty = join(fresh(), 'foodcourt-manual-empty.sqlite');
    writeFileSync(empty, '');
    assert.equal((await backup.verifyBackup({ artisan: s.artisan, file: empty })).ok, false);
    assert.equal((await backup.verifyBackup({ artisan: s.artisan, file: join(dir, 'does-not-exist.sqlite') })).ok, false);
  } finally {
    await s.stop();
  }
});

test('swapping in a backup keeps the replaced data; a failed restore can be rolled back', async () => {
  const dir = fresh();
  let s = await start(dir);
  const outDir = fresh();
  await setupOwner(s);
  const made = await backup.createBackup({ artisan: s.artisan, dir: outDir, kind: 'manual', log });
  const token = (await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
  await call(s, 'POST', '/stalls', { name: 'Newer Stall', code: 'NEW', is_active: true }, token);
  await s.stop();

  const safety = backup.swapDatabase({ dataDir: dir, backupDir: join(dir, 'backups'), source: made.file });
  s = await start(dir);
  try {
    const t = (await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
    assert.ok(!JSON.stringify((await call(s, 'GET', '/stalls', null, t)).json).includes('Newer Stall'), 'restored to the backup state');
  } finally {
    await s.stop();
  }
  backup.rollbackDatabase({ dataDir: dir, safety });
  s = await start(dir);
  try {
    const t = (await call(s, 'POST', '/auth/login', { email: 'asha@example.com', password: STRONG })).json.data.token;
    assert.ok(JSON.stringify((await call(s, 'GET', '/stalls', null, t)).json).includes('Newer Stall'), 'rollback brings the newer data back');
  } finally {
    await s.stop();
  }
});

test('stopping the server removes its process (nothing is left running)', async () => {
  const dir = fresh();
  const s = await start(dir);
  const { pid } = JSON.parse(readFileSync(join(dir, 'server.pid'), 'utf8'));
  assert.ok(pidAlive(pid));
  await s.stop();
  assert.equal(pidAlive(pid), false);
  assert.equal(existsSync(join(dir, 'server.pid')), false);
});

// ------------------------------------------------------------------ real upgrade from the delivered 1.0.2
const OLD_SERVER = join(ROOT, 'installers', '1.0.2', 'win-unpacked', 'resources', 'server');
test('upgrade from the delivered 1.0.2 program: existing owner, data and password are kept; no setup is offered again', { skip: !existsSync(OLD_SERVER) && 'the 1.0.2 build is not on this PC' }, async () => {
  const oldRuntime = es.locateRuntime(OLD_SERVER);
  const dir = fresh();
  // The 1.0.2 launcher is not part of this tree, so start its backend the way it did: migrate, then PHP's own server
  const runOld = es.artisanFor(oldRuntime, dir);
  await runOld(['migrate', '--force']);
  const oldPort = await new Promise((res) => {
    const t = net.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  const oldProc = spawn(oldRuntime.php, [...es.phpArgs(oldRuntime, dir), '-S', `127.0.0.1:${oldPort}`, '-t', join(oldRuntime.backendDir, 'public'), oldRuntime.router], {
    cwd: dir, env: es.buildServerEnv(dir, es.ensureAppKey(dir)), stdio: 'ignore', windowsHide: true,
  });
  assert.ok(await until(async () => (await fetch(`http://127.0.0.1:${oldPort}/up`).catch(() => null))?.status === 200, 30000), '1.0.2 server did not start');
  const old = { url: `http://127.0.0.1:${oldPort}/api`, stop: () => new Promise((r) => { oldProc.once('exit', r); oldProc.kill(); setTimeout(r, 3000); }) };
  writeFileSync(join(dir, 'last-version.txt'), '1.0.2');
  let tokenOld;
  try {
    // 1.0.2 behaviour: setup creates the owner and returns no recovery key
    const made = await call(old, 'POST', '/setup/owner', { name: 'Existing Owner', email: 'Existing.Owner@Shop.com', password: STRONG });
    assert.equal(made.status, 201);
    assert.equal(made.json.data.recovery_key, undefined, 'precondition: 1.0.2 has no recovery keys');
    tokenOld = made.json.data.token;
    assert.ok([200, 201].includes((await call(old, 'POST', '/stalls', { name: 'Chai Point', code: 'CHAI', is_active: true }, tokenOld)).status));
  } finally {
    await old.stop();
  }

  const s = await start(dir, '1.1.0');
  try {
    const copies = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('foodcourt-before-1.1.0-'));
    assert.equal(copies.length, 1, 'the 1.0.2 database was copied aside before the new version touched it');
    const copyReport = await backup.verifyBackup({ artisan: s.artisan, file: join(dir, 'backups', copies[0]) });
    assert.equal(copyReport.ok, true, 'that safety copy is itself a valid database');
    assert.equal(copyReport.migrations_current, false, 'and it is genuinely the OLD schema (the new migration was not in it)');

    assert.equal(s.status().setup, 'complete', 'an installation that already has an owner is never sent to first-run setup');
    assert.equal((await call(s, 'POST', '/setup/owner', { name: 'X', email: 'x@x.com', password: STRONG })).status, 409);
    const login = await call(s, 'POST', '/auth/login', { email: 'existing.owner@shop.com', password: STRONG });
    assert.equal(login.status, 200, 'the same owner and password still sign in (and capital letters in the email no longer matter)');
    const t = login.json.data.token;
    assert.ok(JSON.stringify((await call(s, 'GET', '/stalls', null, t)).json).includes('Chai Point'), 'business data survived');

    // Existing installs have no recovery key yet: the owner can create one from Device Settings
    const bad = await call(s, 'POST', '/setup/recovery-key', { password: 'wrong-pass-1' }, t);
    assert.equal(bad.status, 422);
    const issued = await call(s, 'POST', '/setup/recovery-key', { password: STRONG }, t);
    assert.equal(issued.status, 200);
    assert.match(issued.json.data.recovery_key, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/);
  } finally {
    await s.stop();
  }
});

// ------------------------------------------------------------------ support: diagnose a sign-in problem on a 1.0.2 database
test('support diagnosis: --diagnose-login explains a 1.0.2 owner whose email only differs by capitals, without changing the data', { skip: !existsSync(OLD_SERVER) && 'the 1.0.2 build is not on this PC' }, async () => {
  const oldRuntime = es.locateRuntime(OLD_SERVER);
  const profile = fresh();
  const dir = join(profile, 'server');
  const runOld = es.artisanFor(oldRuntime, dir);
  await runOld(['migrate', '--force']);
  const port = await new Promise((res) => {
    const t = net.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  const proc = spawn(oldRuntime.php, [...es.phpArgs(oldRuntime, dir), '-S', `127.0.0.1:${port}`, '-t', join(oldRuntime.backendDir, 'public'), oldRuntime.router], { cwd: dir, env: es.buildServerEnv(dir, es.ensureAppKey(dir)), stdio: 'ignore', windowsHide: true });
  assert.ok(await until(async () => (await fetch(`http://127.0.0.1:${port}/up`).catch(() => null))?.status === 200, 30000));
  const base = { url: `http://127.0.0.1:${port}/api` };
  try {
    assert.equal((await call(base, 'POST', '/setup/owner', { name: 'Owner', email: 'Shop.Owner@Gmail.com', password: STRONG })).status, 201);
    // What the client experienced with 1.0.2: the exact capitals work, any other spelling is "invalid credentials"
    assert.equal((await call(base, 'POST', '/auth/login', { email: 'shop.owner@gmail.com', password: STRONG })).status, 422, 'defect reproduced on the delivered 1.0.2 build');
    assert.equal((await call(base, 'POST', '/auth/login', { email: 'Shop.Owner@Gmail.com', password: STRONG })).status, 200);
  } finally {
    await new Promise((r) => { proc.once('exit', r); proc.kill(); setTimeout(r, 3000); });
  }
  const before = readFileSync(join(dir, 'foodcourt.sqlite'));

  const electronExe = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  // Electron is a GUI-subsystem program: its stdout reaches a file redirect, not a pipe
  const outFile = join(profile, 'diagnosis-stdout.txt');
  let out;
  try {
    execFileSync('cmd.exe', ['/d', '/s', '/c', `""${electronExe}" "${ROOT}" --diagnose-login=shop.owner@gmail.com --check-password > "${outFile}" 2>&1"`], {
      env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_API_URL: '', FOODCOURT_DIAG_PASSWORD: STRONG },
      timeout: 90000,
      windowsVerbatimArguments: true,
    });
    out = readFileSync(outFile, 'utf8');
  } catch (err) {
    throw new Error(`diagnosis run failed: ${existsSync(outFile) ? readFileSync(outFile, 'utf8').slice(0, 600) : err.message}`);
  }
  const report = JSON.parse(out.trim().split(/\r?\n/).pop());
  assert.equal(report.account_found, true);
  assert.equal(report.role, 'owner');
  assert.equal(report.email_differs_only_by_case_from_stored, true, 'this is exactly the cause');
  assert.equal(report.password_matches, true, 'the password is right; only the email spelling failed');
  assert.equal(report.token_can_be_created, true);
  assert.deepEqual(report.failed_attempts_by_reason, { unknown_email: 1 }, "the 1.0.2 audit trail shows the failed attempt as 'unknown email'");
  assert.doesNotMatch(out, /Str0ngPass99|\$2y\$|Bearer/, 'no secrets in the output');
  assert.deepEqual(readFileSync(join(dir, 'foodcourt.sqlite')), before, 'the diagnosis changed nothing in the database');
  assert.ok(existsSync(join(profile, 'logs', 'diagnose-login.json')));
});
