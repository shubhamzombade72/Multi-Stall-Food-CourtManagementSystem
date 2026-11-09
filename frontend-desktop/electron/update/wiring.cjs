/**
 * Connects the update agent to the running Electron app: settings, Windows-sealed storage, the handover to the separate
 * bootstrapper process, and confirming a trial boot. main.cjs calls this once; it holds no update logic of its own.
 * Test settings (FOODCOURT_UPDATE_*) are honoured only in an unpackaged run.
 */
const { execFile, execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createUpdateAgent } = require('./agent.cjs');
const { createActivity } = require('./activity.cjs');
const rel = require('./releases.cjs');
const schedule = require('./schedule.cjs');
const trust = require('./trust.cjs');
const { readJsonOr } = require('./format.cjs');

const TRIAL_WATCHDOG_MS = 3 * 60 * 1000;
const BACKGROUND_DOWNLOAD_BYTES_PER_SECOND = 2 * 1024 * 1024;

function createUpdates({ app, net, powerMonitor, safeStorage, log, shutdownServer, dataDir, readConfig, resolveConfig, probe, getStartup, printBusy, maintenanceBusy, hasWindow, openUpiCount }) {
  const packaged = app.isPackaged;
  const updateLog = (level, message) => log(level, message, 'update');
  const root = !packaged && process.env.FOODCOURT_UPDATE_ROOT ? path.resolve(process.env.FOODCOURT_UPDATE_ROOT) : rel.defaultRoot();
  const dirs = rel.layout(root);

  /**
   * Trust always starts from the INSTALLED files, the same place the loader and bootstrapper read, so a release cannot pass
   * one and fail the other. The loader says where they are, because this code may itself be running from a release folder.
   */
  const installedTrustFile = !packaged && process.env.FOODCOURT_UPDATE_TRUST ? process.env.FOODCOURT_UPDATE_TRUST : process.env.FOODCOURT_INSTALLED_TRUST_FILE || path.join(__dirname, '..', 'update-trust.json');
  const trusted = () => trust.resolveTrust(installedTrustFile, dirs.trustStatement);
  const applyTrustStatement = (raw, signature, keyId) => trust.applyStatement({ installedFile: installedTrustFile, statementFile: dirs.trustStatement, raw, signature, keyId });

  const activity = createActivity({ printBusy, maintenanceBusy, hasWindow, openUpiCount });

  /** Daily per-user task, so a closed app can still update in the window. Failure only means it waits for the next start. */
  function ensureMaintenanceTask(policy) {
    if (!packaged || process.env.FOODCOURT_UPDATE_NO_TASK === '1') return; // the switch keeps tests off the PC's real task
    const run = (args) => new Promise((resolve) => execFile('schtasks', args, { windowsHide: true, timeout: 15000 }, (err) => resolve(!err)));
    const job = policy.mode === 'ask' ? run(['/Delete', '/F', '/TN', schedule.TASK_NAME]) : run(schedule.taskCreateArgs(process.execPath, policy.window));
    job.then((ok) => updateLog(ok || policy.mode === 'ask' ? 'INFO' : 'WARN', ok || policy.mode === 'ask' ? 'Maintenance task is up to date' : 'The maintenance task could not be created; updates will install at the next start')).catch(() => undefined);
  }

  const serverUrl = () => {
    if (!packaged && process.env.FOODCOURT_UPDATE_URL) return process.env.FOODCOURT_UPDATE_URL;
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app-config.json'), 'utf8')).updateServerUrl || '';
    } catch {
      return '';
    }
  };

  const feedUrl = () => {
    if (!packaged && process.env.FOODCOURT_UPDATE_FEED) return process.env.FOODCOURT_UPDATE_FEED;
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app-config.json'), 'utf8')).updateFeedUrl || '';
    } catch {
      return '';
    }
  };

  const machineFingerprint = (() => {
    let cached;
    return () => {
      if (cached !== undefined) return cached;
      cached = null;
      try {
        const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
        const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
        if (m) cached = crypto.createHash('sha256').update(m[1].toLowerCase()).digest('hex');
      } catch {
        // an install without the value still works; it only loses this cross-check
      }
      return cached;
    };
  })();

  const installed = () => {
    // Which files are "installed" matters only while no release is active, and then this code IS the installed code
    const appRoot = path.join(__dirname, '..', '..');
    const packagedServer = packaged ? path.join(process.resourcesPath, 'server') : path.join(appRoot, 'build-server');
    return { version: app.getVersion(), app: appRoot, server: process.env.FOODCOURT_SERVER_DIR || packagedServer };
  };

  const launchArgs = () => (packaged ? [] : [app.getAppPath()]);

  async function startBootstrap(jobFile) {
    const child = spawn(process.execPath, [...launchArgs(), `--fc-bootstrap=${jobFile}`], { detached: true, stdio: 'ignore', env: rel.cleanEnv() });
    child.unref();
    await shutdownServer();
    setTimeout(() => app.exit(0), 5000).unref();
    app.quit();
  }

  const agent = createUpdateAgent({
    dirs,
    trusted,
    applyTrustStatement,
    activity,
    onPolicyChanged: ensureMaintenanceTask,
    downloadBytesPerSecond: packaged ? BACKGROUND_DOWNLOAD_BYTES_PER_SECOND : 0,
    log: updateLog,
    fetchImpl: (url, options) => net.fetch(url, options),
    seal: (text) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows cannot protect the update key on this account.');
      return safeStorage.encryptString(text);
    },
    unseal: (data) => safeStorage.decryptString(data),
    getCurrentVersion: () => app.getVersion(),
    getMode: () => (readConfig().apiBaseUrl ? 'remote' : 'embedded'),
    getHostApiBase: () => readConfig().apiBaseUrl,
    getDataDir: dataDir,
    getServerUrl: serverUrl,
    getFeedUrl: feedUrl,
    userIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    electronMajor: Number(process.versions.electron.split('.')[0]),
    machineFingerprint,
    installed,
    startBootstrap,
  });

  /** The new version could not confirm it started: quit into recovery, which is what the next start would do anyway. */
  function startRecoveryAndQuit(why) {
    updateLog('ERROR', `New version will be rolled back: ${why}`);
    const active = rel.readActive(dirs);
    if (active && active.state === 'trial') rel.writeActive(dirs, { ...active, boot_attempts: rel.MAX_TRIAL_BOOTS });
    shutdownServer().finally(() => {
      const child = spawn(process.execPath, launchArgs(), { detached: true, stdio: 'ignore', env: rel.cleanEnv() });
      child.unref();
      app.exit(4);
    });
  }

  /** Health as the running app sees it. Only true values count as passing. */
  async function runningHealth(windowLoaded) {
    const cfg = await resolveConfig();
    const health = { startup: windowLoaded, database: false, migrations_current: false, schema_compatible: false };
    if (cfg.apiBaseUrl) {
      const r = await probe(`${cfg.apiBaseUrl}/system/ready`);
      const data = r && r.json && r.json.data;
      if (data) {
        health.database = data.database === true;
        health.migrations_current = data.migrations_current === true;
        health.schema_compatible = data.schema_compatible !== false;
      }
    }
    return health;
  }

  function afterWindow(win) {
    const active = rel.readActive(dirs);
    const trial = Boolean(active && active.state === 'trial');

    agent.start();
    ensureMaintenanceTask(schedule.normalizePolicy(readJsonOr(dirs.policy)));
    win.webContents.on('render-process-gone', () => activity.rendererGone());
    if (!trial) return;

    const watchdog = setTimeout(() => startRecoveryAndQuit('it did not finish starting in time'), Number(process.env.FOODCOURT_TRIAL_WATCHDOG_MS) || TRIAL_WATCHDOG_MS);
    watchdog.unref();
    win.webContents.once('did-finish-load', async () => {
      try {
        if (process.env.FOODCOURT_UPDATE_FAIL_TRIAL === '1' && !packaged) throw new Error('test: trial boot failure');
        const health = await runningHealth(true);
        const ok = await agent.confirmTrial(health);
        clearTimeout(watchdog);
        if (!ok) startRecoveryAndQuit('its health check failed');
      } catch (err) {
        clearTimeout(watchdog);
        startRecoveryAndQuit(err.message);
      }
    });
    void getStartup;
  }

  return { agent, activity, afterWindow };
}

module.exports = { createUpdates };
