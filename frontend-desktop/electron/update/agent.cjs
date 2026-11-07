/**
 * The desktop update agent (no direct Electron imports; main.cjs injects what it needs).
 *
 * It checks and downloads in the background with resume, and verifies. A download never implies permission to install.
 * Installing follows the owner's policy (schedule.cjs): by itself in the maintenance window, once approved, or only from the
 * Update Now button. Every route must also pass the idle gate (activity.cjs). The actual install happens in a separate
 * process (bootstrap.cjs) after this app closes. An update can also come from a signed folder, on a pen drive.
 *
 * The device token stays here, sealed by Windows. The bootstrapper never gets it: it writes reports to an outbox and this
 * agent delivers them, including those from an update that was interrupted.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions, readJsonOr, sha256File, writeFileDurable, writeJsonDurable } = require('./format.cjs');
const rel = require('./releases.cjs');
const { checkDiskSpace, dirBytes, listRecoveryPoints, pruneRecoveryPoints, requiredBytes } = require('./recovery.cjs');
const { writeJob } = require('./bootstrap.cjs');
const schedule = require('./schedule.cjs');
const { isLoopbackHost, normalizeApiUrl } = require('../config.cjs');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// The feed has no way to tell an app about a release, so apps look often. Each look reads only the tiny signature file.
const FEED_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FEED_DOWNLOAD_RETRY_MS = 60 * 60 * 1000;
const IDLE_INSTALL_SECONDS = 2 * 60;
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
// A manifest lists every file of the app, so it can be megabytes on a slow shop connection
const FEED_MANIFEST_TIMEOUT_MS = 120000;
const REMIND_LATER_MS = 24 * 60 * 60 * 1000;
const MAINTENANCE_TICK_MS = 60 * 1000;

/** Update traffic is encrypted, except to this PC itself (tests). A private LAN address is not an exception. */
function updateUrlProblem(url) {
  const normalized = normalizeApiUrl(url);
  if (!normalized) return 'No update service is configured for this installation.';
  const u = new URL(normalized);
  if (u.protocol !== 'https:' && !isLoopbackHost(u.hostname)) return 'The update service must use a secure (https) connection.';
  return null;
}

/** A folder of signed release files on any https host, such as GitHub Releases. Only a plain address is accepted. */
function normalizeFeedUrl(input) {
  if (typeof input !== 'string' || input.length > 300) return null;
  try {
    const u = new URL(input.trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return null;
    if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Every reason this release must not be installed on this PC. Returns { ok, code, problem }. */
function compatibilityProblem({ manifest, currentVersion, highest, electronMajor, mode, hostContract }) {
  const refuse = (code, problem) => ({ ok: false, code, problem });
  if (compareVersions(manifest.version, currentVersion) <= 0) return refuse('downgrade', `Version ${manifest.version} is not newer than the installed ${currentVersion}.`);
  if (highest && compareVersions(manifest.version, highest) < 0) return refuse('downgrade', `Version ${highest} has already run on this computer.`);
  const c = manifest.compatibility || {};
  if (c.platform && c.platform !== 'win32') return refuse('platform', 'This release is not for Windows.');
  if (c.electron_major && c.electron_major !== electronMajor) return refuse('requires_full_installer', 'This release needs the full installer. Ask your administrator for it. Your current version keeps working.');
  if (manifest.package_type === 'incremental' && manifest.source_version !== currentVersion) return refuse('wrong_source', 'This package is for a different installed version.');
  if (manifest.min_supported_version && compareVersions(currentVersion, manifest.min_supported_version) < 0) return refuse('below_minimum', 'The installed version is too old for this release. Contact support.');
  if (mode === 'remote' && c.api_contract && (!hostContract || hostContract < c.api_contract)) {
    return refuse('host_too_old', 'The shared food court host must be updated first. This computer keeps its current version until then.');
  }
  return { ok: true };
}

function createUpdateAgent(deps) {
  const { dirs, log = () => undefined, fetchImpl = globalThis.fetch, seal, unseal, getCurrentVersion, getMode, getHostApiBase, getDataDir, getServerUrl, getFeedUrl = () => '', userIdleSeconds = () => null, electronMajor, machineFingerprint = () => null, startBootstrap, applyTrustStatement, onPolicyChanged, downloadBytesPerSecond = 0 } = deps;
  const statfs = deps.statfs || fs.promises.statfs;
  // Unknown means busy: without a gate nothing may ever close the application
  const activity = deps.activity || { evaluate: async () => ({ idle: false, reasons: ['no_activity_gate'] }) };
  const clock = deps.now || (() => new Date());
  fs.mkdirSync(dirs.state, { recursive: true });

  const state = { phase: 'idle', progress: null, offer: null, error: null, message: null, checkedAt: null, blocked: null, installUnknown: false, waitingFor: [], paused: false };
  let timer = null;
  let maintenanceTimer = null;

  // Keys can change at run time through a rotation statement, so they are always read fresh
  const trustedKeys = () => (typeof deps.trusted === 'function' ? deps.trusted() : deps.trusted) || {};
  const hasKeys = () => Object.keys(trustedKeys()).length > 0;
  const lastResult = () => readJsonOr(path.join(dirs.state, 'last-result.json'));
  // On the feed there is one rule for every PC: a release installs by itself as soon as the PC is not in use. Nothing to set.
  const policy = () => (usesFeed() ? schedule.normalizePolicy(null) : schedule.normalizePolicy(readJsonOr(dirs.policy)));

  /** A ready update, unless it has become pointless, for example because an installer got there first. */
  function usablePending() {
    const pending = readJsonOr(dirs.pending);
    if (!pending?.version) return null;
    if (compareVersions(pending.version, getCurrentVersion()) <= 0 || !fs.existsSync(pending.payload_file || '')) {
      fs.rmSync(dirs.pending, { force: true });
      return null;
    }
    return pending;
  }

  const serverUrl = () => getServerUrl();
  // A feed needs no server and no registration: every install reads the same signed files, and the signature is what is trusted
  const feedBase = () => normalizeFeedUrl(getFeedUrl());
  const usesFeed = () => Boolean(getFeedUrl());
  const serviceProblem = () => {
    if (!usesFeed()) return updateUrlProblem(serverUrl());
    return feedBase() ? null : 'The update address must be a secure (https) address.';
  };

  // ------------------------------------------------------------------ identity
  const readDevice = () => readJsonOr(dirs.device);
  function deviceAuth() {
    const device = readDevice();
    if (!device || !device.token_enc) return null;
    try {
      return { deviceId: device.device_id, token: unseal(Buffer.from(device.token_enc, 'base64')) };
    } catch {
      log('ERROR', 'The update registration could not be read on this Windows account');
      return null;
    }
  }

  async function request(method, urlPath, { body, auth = true, timeout = REQUEST_TIMEOUT_MS } = {}) {
    const url = serverUrl();
    const problem = updateUrlProblem(url);
    if (problem) throw Object.assign(new Error(problem), { code: 'no_service' });
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (auth) {
      const device = deviceAuth();
      if (!device) throw Object.assign(new Error('This computer is not registered for updates.'), { code: 'not_enrolled' });
      headers.Authorization = `Bearer ${device.token}`;
      headers['X-Update-Device'] = device.deviceId;
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetchImpl(`${normalizeApiUrl(url)}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error' });
      const json = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, json };
    } finally {
      clearTimeout(t);
    }
  }

  const describeHttp = (r, fallback) => (r.json && r.json.message) || fallback;

  /** One-time code from the update service's owner. The token that comes back is sealed by Windows at once. */
  async function enroll(code, name) {
    const deviceId = crypto.randomUUID();
    let r;
    try {
      r = await request('POST', '/updates/client/enroll', { auth: false, body: { code: String(code || '').trim().toUpperCase().slice(0, 40), device_id: deviceId, name: String(name || 'Desktop').slice(0, 100), machine_fingerprint: machineFingerprint(), app_version: getCurrentVersion() } });
    } catch (err) {
      return { ok: false, error: err.code === 'no_service' ? err.message : 'The update service could not be reached. Check the internet connection.' };
    }
    if (r.status !== 201 || !r.json?.data?.token) return { ok: false, error: describeHttp(r, 'The code was not accepted.') };
    writeJsonDurable(dirs.device, { device_id: deviceId, client_id: r.json.data.client_id, token_enc: seal(r.json.data.token).toString('base64'), channel: r.json.data.channel, enrolled_at: new Date().toISOString() });
    log('INFO', 'This computer is registered for updates');
    return { ok: true };
  }

  // ------------------------------------------------------------------ outbox
  const readOutbox = () => {
    try {
      return fs.readFileSync(dirs.outbox, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  const enqueue = (targetId, status, extra = {}) => {
    if (targetId) rel.appendLine(dirs.outbox, { target_id: targetId, status, client_time: new Date().toISOString(), ...extra });
  };

  /** Delivers in order and stops at the first network problem, so the server sees the true sequence. */
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !deviceAuth() || updateUrlProblem(serverUrl())) return { delivered: 0 };
    flushing = true;
    let delivered = 0;
    try {
      const items = readOutbox();
      const remaining = [...items];
      for (const item of items) {
        const { target_id: targetId, ...body } = item;
        let r;
        try {
          r = await request('POST', `/updates/client/targets/${targetId}/status`, { body });
        } catch (err) {
          log('WARN', `Update report waits for the network (${err.code || 'network'})`);
          break;
        }
        if (r.status >= 500 || r.status === 401 || r.status === 429) break;
        if (r.status === 409 || r.status === 422 || r.status === 404) {
          log('WARN', `The update service refused a report ${item.status}: ${r.json?.code || r.status}`);
          if (item.status === 'COMPLETED') state.message = 'The update is installed, but the update service did not accept its completion report.';
        }
        remaining.shift();
        delivered += 1;
      }
      if (remaining.length) writeFileDurable(dirs.outbox, `${remaining.map((x) => JSON.stringify(x)).join('\n')}\n`);
      else fs.rmSync(dirs.outbox, { force: true });
    } finally {
      flushing = false;
    }
    return { delivered };
  }

  // ------------------------------------------------------------------ check
  async function currentHealth() {
    return { version: getCurrentVersion(), mode: getMode() };
  }

  async function check({ background = false } = {}) {
    if (state.phase === 'downloading' || state.phase === 'installing') return publicState();
    state.error = null;
    if (!hasKeys()) {
      state.blocked = 'No trusted signing key is configured, so updates are disabled.';
      return publicState();
    }
    const problem = serviceProblem();
    if (problem) {
      state.blocked = problem;
      return publicState();
    }
    state.blocked = null;
    if (usesFeed()) return checkFeed(background);
    if (!deviceAuth()) return publicState();
    await flushOutbox();
    const health = await currentHealth();
    let r;
    try {
      r = await request('POST', '/updates/client/check', { body: { app_version: health.version, mode: health.mode === 'remote' ? 'remote' : 'embedded', machine_fingerprint: machineFingerprint(), schema_fingerprint: readJsonOr(path.join(dirs.state, 'schema.json'))?.fingerprint ?? undefined } });
    } catch {
      state.error = 'The update service could not be reached. Try again later. Your software keeps working.';
      return publicState();
    }
    if (!r.ok) {
      state.error = describeHttp(r, 'The update service refused this computer.');
      return publicState();
    }
    state.checkedAt = new Date().toISOString();
    state.installUnknown = Boolean(r.json.data?.install_unknown);
    state.serverBlocked = r.json.data?.blocked || null;
    const statement = r.json.data?.trust_statement;
    if (statement && applyTrustStatement) {
      const applied = applyTrustStatement(statement.raw, statement.signature, statement.key_id);
      if (!applied.ok) log('WARN', `A signing key change was refused: ${applied.problem}`);
    }
    const offer = r.json.data?.update || null;
    if (offer && compareVersions(offer.version, health.version) <= 0) {
      log('WARN', `The service offered ${offer.version}, which is not newer than ${health.version}; ignored`);
      state.offer = null;
    } else {
      state.offer = offer;
    }
    if (offer) log('INFO', `Update available: ${offer.version} (${offer.package_type})`);
    backgroundDownload();
    return publicState();
  }

  /** Reads one small file from the feed. Hosts redirect to where the file really is. A missing file returns null. */
  async function feedText(name) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FEED_MANIFEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${feedBase()}/${name}`, { headers: { 'Cache-Control': 'no-cache' }, cache: 'no-store', redirect: 'follow', signal: controller.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  /** The newest signed release on the feed. Nothing is offered unless its signature is good and it can run on this PC. */
  async function checkFeed(background) {
    let raw;
    let signature;
    try {
      signature = await feedText('manifest.sig');
      if (signature !== null && signature.trim() === state.feedSignature) {
        // Same release as last time, so the large description need not be read again
        state.checkedAt = new Date().toISOString();
        backgroundDownload(background);
        return publicState();
      }
      // A refused release is not read again on every look. It may be a release caught half way through publishing, so it is retried
      if (background && signature !== null && state.feedRefused?.signature === signature.trim() && clock().getTime() - state.feedRefused.at < FEED_DOWNLOAD_RETRY_MS) {
        state.checkedAt = new Date().toISOString();
        return publicState();
      }
      raw = signature === null ? null : await feedText('manifest.json');
    } catch (err) {
      log('WARN', `Update check failed: ${err.message}`);
      state.error = 'The update service could not be reached. Try again later. Your software keeps working.';
      return publicState();
    }
    state.checkedAt = new Date().toISOString();
    state.serverBlocked = null;
    state.offer = null;
    if (raw === null || signature === null) return publicState(); // nothing has been published yet

    let keyId;
    try {
      keyId = JSON.parse(raw).signing?.key_id;
    } catch {
      keyId = undefined;
    }
    const loaded = rel.loadManifest(raw, signature.trim(), keyId, trustedKeys());
    if (!loaded.ok) {
      state.feedRefused = { signature: signature.trim(), at: clock().getTime() };
      log('ERROR', `The published release was refused: ${loaded.problem}`);
      state.error = 'A published update failed its security check and was ignored. Your software was not changed.';
      return publicState();
    }
    state.feedSignature = signature.trim();
    const manifest = loaded.manifest;
    if (compareVersions(manifest.version, getCurrentVersion()) <= 0) return publicState();

    const mode = getMode();
    const compat = compatibilityProblem({ manifest, currentVersion: getCurrentVersion(), highest: rel.highestVersion(dirs), electronMajor, mode, hostContract: mode === 'remote' ? await hostContract() : null });
    if (!compat.ok) {
      log('WARN', `Update ${manifest.version} cannot be used here [${compat.code}]: ${compat.problem}`);
      state.serverBlocked = compat.code;
      return publicState();
    }
    state.offer = {
      version: manifest.version,
      target_id: null,
      channel: manifest.channel,
      required: manifest.required,
      release_date: manifest.created_at,
      package_type: manifest.package_type,
      package_size: manifest.payload_size,
      notes: manifest.notes,
      feed: { manifest: raw, signature: signature.trim(), signing_key_id: keyId, package_sha256: manifest.payload_sha256, package_size: manifest.payload_size, proof_nonce: null },
    };
    log('INFO', `Update available: ${manifest.version} (${manifest.package_type})`);
    backgroundDownload(background);
    return publicState();
  }

  /** Starts the download by itself after a check. It never waits on, or changes, anything the POS is doing. */
  function backgroundDownload(background = false) {
    const offer = state.offer;
    if (!offer || state.phase !== 'idle' || state.paused) return;
    // Frequent looks must not mean a bad package is fetched again every few minutes on a shop's connection
    if (background && state.downloadFailedAt && clock().getTime() - state.downloadFailedAt < FEED_DOWNLOAD_RETRY_MS) return;
    if (usablePending()?.version === offer.version) return;
    if (schedule.previouslyFailed(lastResult(), offer.version)) return;
    prepare(offer).catch(() => undefined);
  }

  /** Download and verify, then remember that it is ready. Installs nothing. Returns the pending job or throws. */
  async function prepare(offer) {
    state.phase = 'downloading';
    state.error = null;
    state.progress = null;
    try {
      let obtained = await obtainPackage(offer, state.installUnknown);
      if (obtained.needsFull) {
        state.phase = 'downloading';
        obtained = await obtainPackage(offer, true);
        if (obtained.needsFull) throw Object.assign(new Error('The full recovery package could not be used.'), { code: 'package' });
      }
      const pending = { ...obtained.job, source: 'online', ready_at: clock().toISOString(), approved: false };
      state.downloadFailedAt = null;
      writeJsonDurable(dirs.pending, pending);
      log('INFO', `Update ${offer.version} downloaded and verified; waiting for its install time`);
      if (policy().mode === 'silent') await recordApproval(pending, 'silent policy').catch(() => undefined);
      return pending;
    } catch (err) {
      log('ERROR', `Update stopped before anything changed [${err.code || 'error'}]: ${err.message}`);
      state.downloadFailedAt = clock().getTime();
      state.error = err.code === undefined ? 'The update could not continue. Your software was not changed.' : err.message;
      enqueue(offer.target_id, 'FAILED', { category: err.code === 'download' || err.code === 'signature' || err.code === 'package' ? 'download' : 'install', message: String(err.message).slice(0, 900), details: { code: err.code || 'error' } });
      await flushOutbox().catch(() => undefined);
      throw err;
    } finally {
      state.phase = 'idle';
    }
  }

  /** Tells the service, when it can be reached. An offline PC installs anyway and the report follows later. */
  async function recordApproval(pending, why) {
    if (!pending.target_id) return;
    const r = await request('POST', `/updates/client/targets/${pending.target_id}/decision`, { body: { decision: 'approve', source: why } });
    if (!r.ok) log('WARN', `The update service did not record the approval: ${r.json?.code || r.status}`);
  }

  /** The one way an install begins: gate first, then hand over to the separate process and close. */
  async function install(pending, { ownerPressed = false } = {}) {
    const gate = await activity.evaluate({ ownerPressed });
    state.waitingFor = gate.reasons;
    if (!gate.idle) return { ok: false, code: 'busy', reasons: gate.reasons, error: 'Finish the open bill or unsaved work first. The update will wait.' };
    state.phase = 'installing';
    try {
      const jobFile = writeJob(dirs, { ...pending, parent_pid: process.pid });
      fs.rmSync(dirs.pending, { force: true });
      log('INFO', `Handing over to the update bootstrapper for ${pending.version}`);
      await startBootstrap(jobFile);
      return { ok: true };
    } catch (err) {
      state.phase = 'idle';
      log('ERROR', `The install could not start: ${err.message}`);
      return { ok: false, error: 'The update could not start. Your software was not changed.' };
    }
  }

  /** Runs each minute while the app is open. Quietly does nothing until policy, window and idle gate all agree. */
  async function maintenanceTick() {
    const pending = usablePending();
    const decision = schedule.automaticInstall({ pending, policy: policy(), currentVersion: getCurrentVersion(), lastResult: lastResult(), now: clock(), trigger: 'tick', compareVersions, snooze: readJsonOr(dirs.snooze) });
    if (!decision.install || state.phase !== 'idle') return { installed: false, reason: decision.reason };
    if (decision.reason === 'idle') {
      // No reading means busy, like every other signal the idle gate cannot read
      const quiet = userIdleSeconds();
      const required = process.env.FOODCOURT_UPDATE_IDLE_SECONDS === undefined ? IDLE_INSTALL_SECONDS : Number(process.env.FOODCOURT_UPDATE_IDLE_SECONDS);
      if (typeof quiet !== 'number' || quiet < required) return { installed: false, reason: 'pc_in_use' };
    }
    log('INFO', `Update ${pending.version} is installing by itself (${decision.reason}, rule ${policy().mode})`);
    const result = await install(pending);
    if (!result.ok) log('INFO', `Update ${pending.version} is waiting: ${(result.reasons || []).join(', ') || result.error}`);
    return { installed: result.ok, reason: result.ok ? 'installing' : 'busy', reasons: result.reasons };
  }

  function setPolicy(next) {
    if (usesFeed()) return publicState();
    const normalized = schedule.normalizePolicy(next);
    writeJsonDurable(dirs.policy, normalized);
    log('INFO', `Update policy set to ${normalized.mode}, ${normalized.window.start} to ${normalized.window.end}`);
    if (onPolicyChanged) onPolicyChanged(normalized);
    return publicState();
  }

  /** The owner's single approval: this version may install in the next window. */
  async function approvePending() {
    const pending = usablePending();
    if (!pending) return publicState();
    writeJsonDurable(dirs.pending, { ...pending, approved: true });
    await recordApproval(pending, 'owner approval').catch(() => undefined);
    return publicState();
  }

  function pauseDownload(paused) {
    state.paused = Boolean(paused);
    if (!state.paused) backgroundDownload();
    return publicState();
  }

  /**
   * A signed update folder, normally on a pen drive: manifest.json, manifest.sig, payload.fcpkg and optionally
   * trust-statement.json. It passes exactly the same checks as a download and is copied off the drive first. Needs no network
   * and no registration, since the signature is what is trusted, not where the files came from.
   */
  async function prepareFromFolder(folder) {
    if (state.phase !== 'idle') return { ok: false, error: 'An update is already running.' };
    state.phase = 'verifying';
    state.error = null;
    try {
      const statementFile = path.join(folder, 'trust-statement.json');
      if (applyTrustStatement && fs.existsSync(statementFile)) {
        const s = readJsonOr(statementFile);
        const applied = applyTrustStatement(s?.raw, s?.signature, s?.key_id);
        if (!applied.ok) throw Object.assign(new Error(applied.problem), { code: 'signature' });
      }
      const raw = fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8');
      const signature = fs.readFileSync(path.join(folder, 'manifest.sig'), 'utf8').trim();
      let keyId;
      try {
        keyId = JSON.parse(raw).signing?.key_id;
      } catch {
        throw Object.assign(new Error('The update description could not be read.'), { code: 'signature' });
      }
      const loaded = rel.loadManifest(raw, signature, keyId, trustedKeys());
      if (!loaded.ok) throw Object.assign(new Error(loaded.problem), { code: 'signature' });
      const manifest = loaded.manifest;

      const mode = getMode();
      const compat = compatibilityProblem({ manifest, currentVersion: getCurrentVersion(), highest: rel.highestVersion(dirs), electronMajor, mode, hostContract: mode === 'remote' ? await hostContract() : null });
      if (!compat.ok) throw Object.assign(new Error(compat.problem), { code: compat.code });
      await ensureDiskSpace(manifest, mode);

      const sourcePayload = path.join(folder, 'payload.fcpkg');
      const onDrive = await rel.verifyPayload(manifest, sourcePayload);
      if (!onDrive.ok) throw Object.assign(new Error(onDrive.problem), { code: 'package' });

      const dir = downloadDir(manifest.version);
      const manifestFile = path.join(dir, 'manifest.json');
      const signatureFile = path.join(dir, 'manifest.sig');
      const payloadFile = path.join(dir, `payload-${manifest.payload_sha256.slice(0, 16)}.fcpkg`);
      writeFileDurable(manifestFile, raw);
      writeFileDurable(signatureFile, signature);
      fs.rmSync(payloadFile, { force: true });
      fs.copyFileSync(sourcePayload, payloadFile);
      // Read back what reached the disk, since a pen drive can fail part way
      const copied = await rel.verifyPayload(manifest, payloadFile);
      if (!copied.ok) throw Object.assign(new Error(copied.problem), { code: 'package' });

      if (manifest.package_type === 'incremental') {
        const check = await rel.verifySource(manifest, rel.currentSource({ dirs, installed: deps.installed() }));
        if (!check.ok) throw Object.assign(new Error('This update needs the complete package, because this installation differs from what it expects.'), { code: 'source_mismatch' });
      }

      const pending = {
        version: manifest.version,
        target_id: null,
        previous_version: getCurrentVersion(),
        manifest_file: manifestFile,
        signature_file: signatureFile,
        payload_file: payloadFile,
        mode: mode === 'remote' ? 'remote' : 'embedded',
        proof_nonce: null,
        manifest_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
        backward_compatible: manifest.database?.backward_compatible !== false,
        source: 'file',
        ready_at: clock().toISOString(),
        approved: true, // choosing the folder is the approval
      };
      writeJsonDurable(dirs.pending, pending);
      log('INFO', `Update ${manifest.version} read from a folder and verified`);
      return { ok: true, version: manifest.version };
    } catch (err) {
      log('ERROR', `The update folder was refused [${err.code || 'error'}]: ${err.message}`);
      state.error = err.code === undefined ? 'That folder does not hold a usable update.' : err.message;
      return { ok: false, error: state.error, code: err.code };
    } finally {
      state.phase = 'idle';
    }
  }

  function remindLater() {
    if (state.offer?.required) return publicState();
    writeJsonDurable(dirs.snooze, { version: state.offer?.version || usablePending()?.version || null, until: clock().getTime() + REMIND_LATER_MS });
    return publicState();
  }

  async function reject() {
    if (!state.offer) return publicState();
    if (state.offer.required) {
      state.error = 'This update is required and cannot be declined.';
      return publicState();
    }
    if (state.offer.target_id) await request('POST', `/updates/client/targets/${state.offer.target_id}/decision`, { body: { decision: 'reject' } }).catch(() => undefined);
    remindLater();
    return publicState();
  }

  // ------------------------------------------------------------------ download
  const downloadDir = (version) => path.join(dirs.downloads, version);

  /** Plain HTTP Range resume. A server that ignores the Range header sends everything again, which is also handled. */
  async function downloadPayload(tokenData, file) {
    const part = `${file}.part`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const metaFile = `${file}.part.json`;
    const previous = readJsonOr(metaFile);
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (previous?.sha256 !== tokenData.package_sha256 || have > tokenData.package_size) {
      fs.rmSync(part, { force: true });
      have = 0;
    }
    writeJsonDurable(metaFile, { sha256: tokenData.package_sha256 });
    state.progress = { received: have, total: tokenData.package_size };

    if (have < tokenData.package_size) {
      const range = have ? { Range: `bytes=${have}-` } : {};
      let res;
      if (usesFeed()) {
        res = await fetchImpl(`${feedBase()}/payload.fcpkg`, { headers: { 'Cache-Control': 'no-cache', ...range }, cache: 'no-store', redirect: 'follow' });
      } else {
        const device = deviceAuth();
        res = await fetchImpl(`${normalizeApiUrl(serverUrl())}/updates/client/download/${tokenData.token}`, {
          headers: { Authorization: `Bearer ${device.token}`, 'X-Update-Device': device.deviceId, ...range },
          redirect: 'error',
        });
      }
      if (!res.ok || !res.body) throw Object.assign(new Error(`The download was refused (HTTP ${res.status}).`), { code: 'download' });
      if (res.status !== 206) have = 0;
      const fd = fs.openSync(part, have ? 'a' : 'w');
      try {
        for await (const chunk of res.body) {
          fs.writeSync(fd, chunk);
          have += chunk.length;
          state.progress = { received: have, total: tokenData.package_size };
          // Low priority: a pause after each piece keeps the shop's connection and the POS responsive
          if (downloadBytesPerSecond > 0) await new Promise((r) => setTimeout(r, Math.round((chunk.length / downloadBytesPerSecond) * 1000)));
          while (state.paused) await new Promise((r) => setTimeout(r, 1000));
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    if (fs.statSync(part).size !== tokenData.package_size) throw Object.assign(new Error('The download stopped before it finished. Try again to continue it.'), { code: 'download' });
    fs.rmSync(file, { force: true });
    fs.renameSync(part, file);
    fs.rmSync(metaFile, { force: true });
  }

  async function fetchToken(targetId, full) {
    const r = await request('POST', `/updates/client/targets/${targetId}/download-token`, { body: { full: Boolean(full) } });
    if (!r.ok) throw Object.assign(new Error(describeHttp(r, 'The update service did not allow this download.')), { code: r.json?.code || 'download' });
    return r.json.data;
  }

  async function hostContract() {
    const base = getHostApiBase && getHostApiBase();
    if (!base) return null;
    try {
      const res = await fetchImpl(`${base}/system/compat`, { headers: { Accept: 'application/json' }, redirect: 'error' });
      return res.ok ? (await res.json())?.data?.api_contract ?? null : null;
    } catch {
      return null;
    }
  }

  async function ensureDiskSpace(manifest, mode) {
    const dataDir = getDataDir();
    const db = path.join(dataDir, 'foodcourt.sqlite');
    const needed = requiredBytes({
      dbBytes: mode === 'remote' || !fs.existsSync(db) ? 0 : fs.statSync(db).size,
      attachmentBytes: mode === 'remote' ? 0 : dirBytes(path.join(dataDir, 'storage', 'app')),
      treeBytes: manifest.tree.reduce((n, f) => n + f.size, 0),
      payloadBytes: manifest.payload_size,
    });
    const disk = await checkDiskSpace(dirs.root, needed, statfs);
    if (!disk.ok) throw Object.assign(new Error(`Not enough free disk space for this update. ${Math.ceil(disk.needed / 1048576)} MB are needed.`), { code: 'disk' });
  }

  /** Verified manifest, compatibility, disk, download, package hash, and source check. Returns the job for the bootstrapper. */
  async function obtainPackage(offer, full) {
    const version = offer.version;
    const dir = downloadDir(version);
    const token = offer.feed || (await fetchToken(offer.target_id, full));

    // The signature is checked before a single package byte is accepted
    const keyId = token.signing_key_id;
    const loaded = rel.loadManifest(token.manifest, token.signature, keyId, trustedKeys());
    if (!loaded.ok) throw Object.assign(new Error(loaded.problem), { code: 'signature' });
    const manifest = loaded.manifest;
    if (manifest.version !== version) throw Object.assign(new Error('The signed release is not the version that was offered.'), { code: 'signature' });
    if (manifest.payload_sha256 !== token.package_sha256) throw Object.assign(new Error('The package does not match its signed description.'), { code: 'signature' });

    const mode = getMode();
    const compat = compatibilityProblem({ manifest, currentVersion: getCurrentVersion(), highest: rel.highestVersion(dirs), electronMajor, mode, hostContract: mode === 'remote' ? await hostContract() : null });
    if (!compat.ok) throw Object.assign(new Error(compat.problem), { code: compat.code });
    await ensureDiskSpace(manifest, mode);

    const manifestFile = path.join(dir, 'manifest.json');
    const signatureFile = path.join(dir, 'manifest.sig');
    writeFileDurable(manifestFile, token.manifest);
    writeFileDurable(signatureFile, token.signature);
    enqueue(offer.target_id, 'DOWNLOADING', { category: 'download' });
    await flushOutbox();

    const payloadFile = path.join(dir, `payload-${manifest.payload_sha256.slice(0, 16)}.fcpkg`);
    if (!fs.existsSync(payloadFile) || (await sha256File(payloadFile)) !== manifest.payload_sha256) await downloadPayload(token, payloadFile);

    state.phase = 'verifying';
    enqueue(offer.target_id, 'VERIFYING', { category: 'download' });
    await flushOutbox();
    const verified = await rel.verifyPayload(manifest, payloadFile);
    if (!verified.ok) {
      fs.rmSync(payloadFile, { force: true });
      throw Object.assign(new Error(verified.problem), { code: 'package' });
    }

    if (manifest.package_type === 'incremental') {
      const source = rel.currentSource({ dirs, installed: deps.installed() });
      const check = await rel.verifySource(manifest, source);
      if (!check.ok) {
        log('WARN', `This install differs from ${manifest.source_version} (${check.mismatches.length}+ files, first ${check.mismatches[0]}); using the full recovery package`);
        fs.rmSync(payloadFile, { force: true });
        return { needsFull: true };
      }
    }

    return {
      job: {
        version,
        target_id: offer.target_id,
        previous_version: getCurrentVersion(),
        manifest_file: manifestFile,
        signature_file: signatureFile,
        payload_file: payloadFile,
        mode: mode === 'remote' ? 'remote' : 'embedded',
        proof_nonce: token.proof_nonce,
        manifest_sha256: crypto.createHash('sha256').update(token.manifest).digest('hex'),
        backward_compatible: manifest.database?.backward_compatible !== false,
      },
    };
  }

  // ------------------------------------------------------------------ the owner's button
  /** Install now: whatever is ready, or download it first. Still refuses while the POS has work open. */
  async function updateNow() {
    const offer = state.offer;
    let pending = usablePending();
    if (!offer && !pending) return { ok: false, error: 'There is no update to install.' };
    if (state.phase !== 'idle') return { ok: false, error: 'The update is already running.' };

    const gate = await activity.evaluate({ ownerPressed: true });
    state.waitingFor = gate.reasons;
    if (!gate.idle) return { ok: false, code: 'busy', reasons: gate.reasons, error: 'Finish the open bill or unsaved work first. The update will wait.' };

    try {
      if (!pending) pending = await prepare(offer);
      await recordApproval(pending, 'owner approval').catch(() => undefined);
      return await install(pending, { ownerPressed: true });
    } catch (err) {
      return { ok: false, error: state.error, code: err.code };
    }
  }

  // ------------------------------------------------------------------ confirming a trial boot
  /**
   * Runs once the new version really started: window loaded and API answering. Only now is the update complete.
   * `health` comes from the running app. Returns true when confirmed; false means the caller must start recovery.
   */
  async function confirmTrial(health) {
    const active = rel.readActive(dirs);
    if (!active || active.state !== 'trial') return true;
    const journal = rel.readJournal(dirs);
    const required = ['startup', 'database', 'migrations_current', 'schema_compatible'];
    const failing = required.filter((k) => health[k] !== true);
    if (failing.length) {
      log('ERROR', `The new version failed its health check: ${failing.join(', ')}`);
      return false;
    }
    rel.writeActive(dirs, { ...active, state: 'confirmed', confirmed_at: new Date().toISOString() });
    rel.recordHighestVersion(dirs, active.version);
    if (journal) {
      const proof = journal.target_id ? completionProof(journal) : null;
      if (journal.schema_fingerprint) writeJsonDurable(path.join(dirs.state, 'schema.json'), { fingerprint: journal.schema_fingerprint, version: active.version });
      if (journal.target_id) {
        enqueue(journal.target_id, 'COMPLETED', { category: 'lifecycle', app_version: active.version, manifest_sha256: journal.manifest_sha256, schema_fingerprint: journal.schema_fingerprint || undefined, health, proof });
      }
      rel.closeJournal(dirs, journal, 'completed');
    }
    writeJsonDurable(path.join(dirs.state, 'last-result.json'), { outcome: 'completed', version: active.version, at: new Date().toISOString() });
    state.message = `Updated to version ${active.version}.`;

    // Housekeeping only after success: older releases and recovery points, keeping the fallback and the newest ones
    try {
      rel.pruneReleases(dirs);
      pruneRecoveryPoints(dirs.recovery, { referenced: journal?.recovery_point ? [journal.recovery_point] : [] });
      rel.clearStaging(dirs);
      fs.rmSync(path.dirname(journal?.manifest_file || path.join(dirs.downloads, active.version, 'x')), { recursive: true, force: true, maxRetries: 2 });
    } catch (err) {
      log('WARN', `Update clean-up was incomplete: ${err.message}`);
    }
    await flushOutbox().catch(() => undefined);
    log('INFO', `Update to ${active.version} confirmed`);
    return true;
  }

  function completionProof(journal) {
    const device = deviceAuth();
    if (!device) return null;
    const key = crypto.createHash('sha256').update(device.token).digest('hex');
    const message = [journal.target_id, journal.proof_nonce, journal.version, journal.manifest_sha256, journal.schema_fingerprint || ''].join('|');
    return crypto.createHmac('sha256', key).update(message).digest('hex');
  }

  // ------------------------------------------------------------------ state for the UI
  function publicState() {
    const snooze = readJsonOr(dirs.snooze);
    const device = readDevice();
    const offer = state.offer;
    const currentPolicy = policy();
    const pending = usablePending();
    const isSnoozed = pending && snooze && snooze.version === pending.version && snooze.until > clock().getTime();
    const scheduled = pending && !isSnoozed && (currentPolicy.mode === 'silent' || currentPolicy.mode === 'idle' || (currentPolicy.mode === 'approve_once' && pending.approved)) && !schedule.previouslyFailed(lastResult(), pending.version);
    return {
      enabled: hasKeys() && !serviceProblem(),
      blocked: state.blocked || (!hasKeys() ? 'No trusted signing key is configured, so updates are disabled.' : serviceProblem()),
      hasKeys: hasKeys(),
      policy: currentPolicy,
      policyLocked: usesFeed(),
      pending: pending ? { version: pending.version, source: pending.source || 'online', readyAt: pending.ready_at, approved: Boolean(pending.approved), installAt: scheduled ? schedule.nextWindowStart(clock(), currentPolicy.window).toISOString() : null } : null,
      waitingFor: state.waitingFor,
      paused: state.paused,
      enrolled: usesFeed() || Boolean(device?.token_enc),
      channel: device?.channel || null,
      currentVersion: getCurrentVersion(),
      mode: getMode() === 'remote' ? 'remote' : 'embedded',
      phase: state.phase,
      progress: state.progress,
      error: state.error,
      message: state.message,
      checkedAt: state.checkedAt,
      serverBlocked: state.serverBlocked || null,
      update: offer ? { version: offer.version, channel: offer.channel, required: offer.required, releaseDate: offer.release_date, packageType: offer.package_type, packageSize: offer.package_size, notes: offer.notes || {} } : null,
      snoozed: Boolean(offer && snooze && snooze.version === offer.version && snooze.until > Date.now() && !offer.required),
      lastResult: lastResult(),
      recoveryPoints: listRecoveryPoints(dirs.recovery).length,
    };
  }

  function start() {
    if (timer) return;
    // A rule saved by an older version must not hold this PC to the night window, here or in the loader
    if (usesFeed()) fs.rmSync(dirs.policy, { force: true });
    const tick = () => check({ background: true }).catch((err) => log('WARN', `Update check failed: ${err.message}`));
    setTimeout(tick, Number(process.env.FOODCOURT_UPDATE_FIRST_CHECK_MS) || FIRST_CHECK_DELAY_MS).unref();
    timer = setInterval(tick, usesFeed() ? Number(process.env.FOODCOURT_UPDATE_CHECK_MS) || FEED_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS);
    timer.unref();
    maintenanceTimer = setInterval(() => maintenanceTick().catch((err) => log('WARN', `Maintenance check failed: ${err.message}`)), MAINTENANCE_TICK_MS);
    maintenanceTimer.unref();
    flushOutbox().catch(() => undefined);
  }

  return { enroll, check, updateNow, remindLater, reject, confirmTrial, flushOutbox, publicState, start, downloadPayload, obtainPackage, completionProof, prepare, install, maintenanceTick, setPolicy, approvePending, pauseDownload, prepareFromFolder, usablePending };
}

module.exports = { createUpdateAgent, updateUrlProblem, normalizeFeedUrl, compatibilityProblem };
