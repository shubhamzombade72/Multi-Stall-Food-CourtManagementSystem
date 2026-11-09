/**
 * The update bootstrapper's logic: runs in its own process after the app has closed, so no business write can happen
 * while the database and program files change. No Electron imports; `loader.cjs` gives it a progress window and the tests
 * run it directly with real PHP and real SQLite.
 *
 * Order, with the journal written before each step so a power cut anywhere is recoverable:
 *   process check, re-verify package, build and verify release in staging, recovery point, integrity snapshot, migrate using the
 *   new release, schema check, data comparison, move release into place, health check, switch pointer (trial), restart.
 *
 * Failure: recover(). It restores the previous program, restores the database only when that is both needed and proven safe,
 * verifies the outcome, reports it, and stops for a developer if safety cannot be established.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { sha256File, writeJsonDurable, readJsonOr } = require('./format.cjs');
const rel = require('./releases.cjs');
const recovery = require('./recovery.cjs');
const { artisanFor, locateRuntime, reclaimOrphan, startEmbeddedServer } = require('../embedded-server.cjs');

const PARENT_EXIT_TIMEOUT_MS = 60000;
const DEVELOPER_MESSAGE = 'An update could not be finished safely. Your data has not been overwritten. Do not use this computer for sales until support has looked at it.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function waitForExit(pid, timeoutMs = PARENT_EXIT_TIMEOUT_MS) {
  if (!pid) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await sleep(200);
  }
  return !processAlive(pid);
}

class UpdateStop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * ctx: { dirs, dataDir, userData, installed:{version,app,server}, trusted, hooks? , log, onStatus, startServer? }
 * job: what the agent verified: { version, target_id, previous_version, manifest_file, signature_file, payload_file, parent_pid, mode, proof_nonce }
 */
function createBootstrap(ctx) {
  const { dirs, dataDir, userData, installed, trusted, log = () => undefined, onStatus = () => undefined } = ctx;
  const hooks = ctx.hooks || {};
  const startServer = ctx.startServer || startEmbeddedServer;
  const hook = async (name) => {
    if (hooks[name]) await hooks[name]();
  };

  /** Writes a report for the update service. The app delivers these when it next runs; this process holds no device token. */
  const report = (journal, status, extra = {}) => {
    onStatus(status, extra.message || '');
    if (journal && journal.target_id) {
      rel.appendLine(dirs.outbox, { target_id: journal.target_id, status, client_time: new Date().toISOString(), ...extra });
    }
  };

  const journalUpdate = (journal, patch) => {
    Object.assign(journal, patch);
    rel.writeJournal(dirs, journal);
    return journal;
  };

  const runtimeOfSource = (source) => {
    const runtime = locateRuntime(source.server);
    if (!runtime) throw new UpdateStop('runtime_missing', 'The program files of the current version are missing.');
    return runtime;
  };

  const artisanOf = (serverDir) => {
    const runtime = locateRuntime(serverDir);
    if (!runtime) throw new UpdateStop('runtime_missing', 'The program files needed for this step are missing.');
    return artisanFor(runtime, dataDir);
  };

  const dbFile = () => path.join(dataDir, 'foodcourt.sqlite');
  const dbHash = async () => (fs.existsSync(dbFile()) ? sha256File(dbFile()) : null);

  // ------------------------------------------------------------------ the update
  async function run(job) {
    const previous = rel.readActive(dirs);
    const journal = journalUpdate({ ...job }, {
      phase: 'PREPARED',
      id: `upd-${Date.now()}-${randomBytes(3).toString('hex')}`,
      started_at: new Date().toISOString(),
      previous_active: previous || null,
    });

    try {
      // 1. The app has closed, and nothing of ours still holds the database
      if (!(await waitForExit(job.parent_pid))) throw new UpdateStop('app_still_running', 'The application did not close.');
      await reclaimOrphan(dataDir, log);
      await hook('afterProcessCheck');

      // 2. Re-verify everything: the files have been on disk since the agent looked at them
      report(journal, 'VERIFYING', { category: 'download' });
      const raw = fs.readFileSync(job.manifest_file, 'utf8');
      const signature = fs.readFileSync(job.signature_file, 'utf8').trim();
      const loaded = rel.loadManifest(raw, signature, JSON.parse(raw).signing?.key_id, trusted);
      if (!loaded.ok) throw new UpdateStop('signature', loaded.problem);
      const manifest = loaded.manifest;
      if (manifest.version !== job.version) throw new UpdateStop('signature', 'The package is for a different version than was approved.');
      const payload = await rel.verifyPayload(manifest, job.payload_file);
      if (!payload.ok) throw new UpdateStop('package', payload.problem);

      // 3. Build the new release beside the running one and verify every file
      const source = rel.currentSource({ dirs, installed });
      fs.mkdirSync(dirs.staging, { recursive: true });
      const staged = await rel.buildStagedRelease({ dirs, manifest, rawManifest: raw, signature, payloadFile: job.payload_file, source });
      journalUpdate(journal, { staged, backward_compatible: manifest.database?.backward_compatible !== false });
      await hook('afterStaging');

      const useLocalDb = job.mode !== 'remote';
      let fingerprint = null;
      let snapshotFile = null;

      if (useLocalDb) {
        // 4. Writes are stopped (server down, single-instance lock held). Back up and verify before anything changes.
        journalUpdate(journal, { phase: 'BACKUP' });
        report(journal, 'BACKUP_IN_PROGRESS', { category: 'lifecycle' });
        const stagedServer = path.join(staged, 'server');
        const oldArtisan = artisanOf(source.server);
        const needed = recovery.requiredBytes({ dbBytes: fs.existsSync(dbFile()) ? fs.statSync(dbFile()).size : 0, attachmentBytes: recovery.dirBytes(path.join(dataDir, 'storage', 'app')), treeBytes: 0, payloadBytes: 0 });
        const statfs = hooks.statfs || fs.promises.statfs;
        const disk = await recovery.checkDiskSpace(dirs.recovery, needed, statfs);
        if (!disk.ok) throw new UpdateStop('disk', `Not enough free disk space for a safe backup (${Math.ceil(disk.needed / 1048576)} MB needed).`);

        await hook('beforeRecoveryPoint');
        const point = await recovery.createRecoveryPoint({ artisan: oldArtisan, dataDir, userData, recoveryRoot: dirs.recovery, fromVersion: job.previous_version, toVersion: job.version, log });
        if (!point.ok) throw new UpdateStop('backup', point.error);
        snapshotFile = path.join(point.dir, 'snapshot.json');
        journalUpdate(journal, { recovery_point: point.id, has_database: point.metadata.has_database, pre_migration_sha: await dbHash() });

        // 5. Migrate with the NEW release's code. First failure stops.
        const newArtisan = artisanOf(stagedServer);
        journalUpdate(journal, { phase: 'MIGRATING' });
        fs.closeSync(fs.openSync(dbFile(), 'a')); // first run: SQLite needs the (empty) file to exist; never truncates
        const changes = Boolean(manifest.database?.new_migrations?.length) || !point.metadata.has_database;
        if (changes) report(journal, 'MIGRATING', { category: 'migration' });
        await hook('beforeMigrate');
        const migration = await recovery.artisanJson(newArtisan, ['foodcourt:update-db', 'apply', `--manifest=${job.manifest_file}`, `--release=${job.version}`]);
        if (!migration || !migration.ok) throw new UpdateStop(migration?.code === 'schema_mismatch' ? 'schema' : 'migration', (migration && migration.problems && migration.problems[0]) || 'The database could not be updated.');
        fingerprint = migration.schema_fingerprint;
        await hook('afterMigrate');

        // 6. Prove the business data survived
        if (point.metadata.has_database) {
          const afterRaw = await recovery.artisanJson(newArtisan, ['foodcourt:update-db', 'snapshot']);
          if (!afterRaw || !afterRaw.ok) throw new UpdateStop('integrity', 'The business data could not be measured after the update.');
          const afterFile = path.join(dirs.state, `snapshot-after-${journal.id}.json`);
          writeJsonDurable(afterFile, afterRaw.snapshot);
          const compared = await recovery.artisanJson(newArtisan, ['foodcourt:update-db', 'compare', `--before=${snapshotFile}`, `--after=${afterFile}`, `--manifest=${job.manifest_file}`]);
          fs.rmSync(afterFile, { force: true });
          if (!compared || !compared.ok) throw new UpdateStop('integrity', `Business data changed during the update: ${(compared && compared.problems && compared.problems[0]) || 'unknown'}`);
        }
        journalUpdate(journal, { phase: 'MIGRATED', schema_fingerprint: fingerprint });
      }

      // 7. Install: the verified folder becomes a release. Nothing runs from it yet.
      journalUpdate(journal, { phase: 'INSTALLING' });
      report(journal, 'INSTALLING', { category: 'install' });
      const installedDir = rel.promoteRelease(dirs, staged, job.version);
      journalUpdate(journal, { staged: null, installed_dir: installedDir });
      await hook('afterInstall');

      // 8. Health check: really start the new release against the migrated database
      journalUpdate(journal, { phase: 'HEALTH_CHECK' });
      report(journal, 'HEALTH_CHECK', { category: 'health' });
      if (useLocalDb) {
        const runtime = locateRuntime(path.join(installedDir, 'server'));
        if (!runtime) throw new UpdateStop('health', 'The new version is incomplete.');
        const previousManaged = process.env.FOODCOURT_MANAGED_RELEASE;
        process.env.FOODCOURT_MANAGED_RELEASE = '1';
        try {
          const server = await startServer({ runtime, dataDir, version: job.version, log, onStatus: () => undefined });
          await server.stop();
        } catch (err) {
          throw new UpdateStop('health', `The new version did not start: ${err.code || err.message}`);
        } finally {
          if (previousManaged === undefined) delete process.env.FOODCOURT_MANAGED_RELEASE;
          else process.env.FOODCOURT_MANAGED_RELEASE = previousManaged;
        }
      }
      await hook('afterHealth');

      // 9. Switch. Trial until the running app confirms; a database hash taken now is what makes a later restore decidable.
      const postSha = useLocalDb ? await dbHash() : null;
      const previousPointer = previous && previous.version ? { kind: 'release', version: previous.version } : { kind: 'installed', version: installed.version };
      journalUpdate(journal, { post_migration_sha: postSha, previous_pointer: previousPointer, schema_fingerprint: fingerprint });
      rel.writeActive(dirs, { version: job.version, state: 'trial', boot_attempts: 0, previous: previousPointer, switched_at: new Date().toISOString() });
      journalUpdate(journal, { phase: 'TRIAL' });
      fs.rmSync(job.payload_file, { force: true });
      log('INFO', `Update to ${job.version} installed; waiting for the new version to confirm it started`);
      return { ok: true, phase: 'TRIAL' };
    } catch (err) {
      log('ERROR', `Update stopped [${err.code || 'error'}]: ${err.message}`);
      report(journal, 'FAILED', { category: categoryFor(err.code), message: err.message.slice(0, 900), details: { code: err.code || 'error', needs_full: err.code === 'source_mismatch' } });
      journalUpdate(journal, { failure_code: err.code || 'error', failure: err.message.slice(0, 900) });
      return recover(journal, { failed: true });
    }
  }

  function categoryFor(code) {
    if (['migration', 'schema', 'integrity'].includes(code)) return 'migration';
    if (['package', 'signature'].includes(code)) return 'download';
    if (code === 'health') return 'health';
    return 'install';
  }

  // ------------------------------------------------------------------ recovery
  /**
   * Finishes a stopped update safely. Called right after a failure, or on the next start if the machine died. Always leaves
   * either a working previous version (`RECOVERED`) or a clear stop for a developer (`NEEDS_DEVELOPER`).
   */
  async function recover(journalIn, { failed = false } = {}) {
    const journal = journalIn;
    const phase = journal.phase;
    if (!failed) report(journal, 'FAILED', { category: 'recovery', message: `The update stopped unexpectedly at ${phase}.`, details: { code: 'interrupted', phase } });
    report(journal, 'RECOVERY_IN_PROGRESS', { category: 'recovery' });
    log('WARN', `Recovery started from phase ${phase}`);

    let restored = false;
    let databaseVerified = !journal.has_database;

    try {
      // 1. Previous program first: this never touches client data
      const pointer = rel.readActive(dirs);
      if (pointer && pointer.version === journal.version) {
        const prev = journal.previous_active;
        if (prev && prev.version) rel.writeActive(dirs, { ...prev, state: 'confirmed' });
        else rel.clearActive(dirs);
        log('INFO', 'Previous program version made active again');
      }
      const source = rel.currentSource({ dirs, installed });

      // 2. Database, only if a recovery point exists (no point means migration never began)
      const pointDir = journal.recovery_point ? path.join(dirs.recovery, journal.recovery_point) : null;
      if (pointDir && journal.has_database && journal.mode !== 'remote') {
        await reclaimOrphan(dataDir, log);
        const artisan = artisanOf(source.server);
        const before = path.join(pointDir, 'snapshot.json');
        const resolved = await recovery.artisanJson(artisan, ['foodcourt:update-db', 'resolve', `--before=${before}`]);
        if (resolved && resolved.ok && resolved.unchanged) {
          log('INFO', 'The database is exactly as it was before the update; nothing to restore');
          databaseVerified = true;
        } else if (resolved && resolved.ok && phase === 'TRIAL' && resolved.integrity === 'ok' && (resolved.differences || []).length === 0 && journal.backward_compatible !== false) {
          // Migrations succeeded and were additive, so the previous version runs on it and no restore is needed
          log('INFO', 'The expanded database keeps all data and the previous version can use it; not restoring');
          databaseVerified = true;
        } else {
          log('WARN', `Database differs from before the update: ${JSON.stringify(resolved && resolved.differences)}; schema same: ${resolved && resolved.schema_same}`);
          const decision = recovery.restoreDecision({ phase, currentSha: await dbHash(), postMigrationSha: journal.post_migration_sha });
          if (!decision.safe) return stopForDeveloper(journal, `Automatic restore refused: ${decision.reason}.`);
          const done = await recovery.restoreDatabase({ dir: pointDir, dataDir, userData, log });
          if (!done.ok) return stopForDeveloper(journal, `The restore could not run: ${done.error}`);
          restored = true;

          const verify = await recovery.artisanJson(artisan, ['foodcourt:backup', dbFile(), '--verify']);
          if (!verify || !verify.ok) return stopForDeveloper(journal, 'The restored database failed its integrity check.');
          const check = await recovery.artisanJson(artisan, ['foodcourt:update-db', 'resolve', `--before=${before}`]);
          if (!check || !check.ok || !check.unchanged) return stopForDeveloper(journal, 'The restored data does not match the totals taken before the update.');
          databaseVerified = true;
        }
      }

      // 3. Clean up what is safe: staged files and the failed release folder. Recovery points stay.
      rel.clearStaging(dirs);
      if (journal.installed_dir && fs.existsSync(journal.installed_dir)) fs.rmSync(journal.installed_dir, { recursive: true, force: true, maxRetries: 3 });

      report(journal, 'RECOVERED', { category: 'recovery', details: { restored_database: restored, database_verified: databaseVerified, running_version: source.version, failure_code: journal.failure_code || 'interrupted' } });
      rel.closeJournal(dirs, { ...journal, restored_database: restored }, 'recovered');
      log('INFO', `Recovered: running ${source.version}, database restored: ${restored}`);
      return { ok: false, recovered: true, restored_database: restored, database_verified: databaseVerified, running_version: source.version, failure: journal.failure };
    } catch (err) {
      return stopForDeveloper(journal, `Recovery failed: ${err.message}`);
    }
  }

  function stopForDeveloper(journal, why) {
    log('ERROR', `Stopped for a developer: ${why}`);
    report(journal, 'FAILED', { category: 'recovery', message: why.slice(0, 900), details: { code: 'needs_developer' } });
    rel.writeJournal(dirs, { ...journal, phase: 'NEEDS_DEVELOPER', message: DEVELOPER_MESSAGE, reason: why });
    return { ok: false, recovered: false, needs_developer: true, reason: why };
  }

  return { run, recover };
}

/** Written by the agent, read by the separate process. */
function writeJob(dirs, job) {
  const file = path.join(dirs.state, 'job.json');
  writeJsonDurable(file, job);
  return file;
}

const readJob = (file) => readJsonOr(file);

module.exports = { createBootstrap, writeJob, readJob, waitForExit, processAlive, DEVELOPER_MESSAGE, hostname: os.hostname };
