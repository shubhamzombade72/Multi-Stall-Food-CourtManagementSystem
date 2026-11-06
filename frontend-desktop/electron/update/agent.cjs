/**
 * The desktop update agent (no direct Electron imports; main.cjs injects what it needs).
 *
 * It checks, shows, asks, downloads with resume and verifies. It never installs anything by itself: installation only
 * begins from `updateNow()`, which the UI calls after the client approved. The actual install happens in a separate
 * process (bootstrap.cjs) after this app closes.
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
const { isLoopbackHost, normalizeApiUrl } = require('../config.cjs');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const REMIND_LATER_MS = 24 * 60 * 60 * 1000;

/** Update traffic is encrypted, except to this PC itself (tests). A private LAN address is not an exception. */
function updateUrlProblem(url) {
  const normalized = normalizeApiUrl(url);
  if (!normalized) return 'No update service is configured for this installation.';
  const u = new URL(normalized);
  if (u.protocol !== 'https:' && !isLoopbackHost(u.hostname)) return 'The update service must use a secure (https) connection.';
  return null;
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
  const { dirs, trusted, log = () => undefined, fetchImpl = globalThis.fetch, seal, unseal, getCurrentVersion, getMode, getHostApiBase, getDataDir, getServerUrl, electronMajor, machineFingerprint = () => null, startBootstrap } = deps;
  const statfs = deps.statfs || fs.promises.statfs;
  fs.mkdirSync(dirs.state, { recursive: true });

  const state = { phase: 'idle', progress: null, offer: null, error: null, message: null, checkedAt: null, blocked: null, installUnknown: false };
  let timer = null;

  const serverUrl = () => getServerUrl();

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

  async function check() {
    if (state.phase === 'downloading' || state.phase === 'installing') return publicState();
    state.error = null;
    if (!Object.keys(trusted || {}).length) {
      state.blocked = 'No trusted signing key is configured, so updates are disabled.';
      return publicState();
    }
    const problem = updateUrlProblem(serverUrl());
    if (problem) {
      state.blocked = problem;
      return publicState();
    }
    state.blocked = null;
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
    const offer = r.json.data?.update || null;
    if (offer && compareVersions(offer.version, health.version) <= 0) {
      log('WARN', `The service offered ${offer.version}, which is not newer than ${health.version}; ignored`);
      state.offer = null;
    } else {
      state.offer = offer;
    }
    if (offer) log('INFO', `Update available: ${offer.version} (${offer.package_type})`);
    return publicState();
  }

  function remindLater() {
    if (state.offer?.required) return publicState();
    writeJsonDurable(dirs.snooze, { version: state.offer?.version || null, until: Date.now() + REMIND_LATER_MS });
    return publicState();
  }

  async function reject() {
    if (!state.offer) return publicState();
    if (state.offer.required) {
      state.error = 'This update is required and cannot be declined.';
      return publicState();
    }
    await request('POST', `/updates/client/targets/${state.offer.target_id}/decision`, { body: { decision: 'reject' } }).catch(() => undefined);
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
      const device = deviceAuth();
      const res = await fetchImpl(`${normalizeApiUrl(serverUrl())}/updates/client/download/${tokenData.token}`, {
        headers: { Authorization: `Bearer ${device.token}`, 'X-Update-Device': device.deviceId, ...(have ? { Range: `bytes=${have}-` } : {}) },
        redirect: 'error',
      });
      if (!res.ok || !res.body) throw Object.assign(new Error(`The download was refused (HTTP ${res.status}).`), { code: 'download' });
      if (res.status !== 206) have = 0;
      const fd = fs.openSync(part, have ? 'a' : 'w');
      try {
        for await (const chunk of res.body) {
          fs.writeSync(fd, chunk);
          have += chunk.length;
          state.progress = { received: have, total: tokenData.package_size };
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

  /** Verified manifest, compatibility, disk, download, package hash, and source check. Returns the job for the bootstrapper. */
  async function obtainPackage(offer, full) {
    const version = offer.version;
    const dir = downloadDir(version);
    const token = await fetchToken(offer.target_id, full);

    // The signature is checked before a single package byte is accepted
    const keyId = token.signing_key_id;
    const loaded = rel.loadManifest(token.manifest, token.signature, keyId, trusted);
    if (!loaded.ok) throw Object.assign(new Error(loaded.problem), { code: 'signature' });
    const manifest = loaded.manifest;
    if (manifest.version !== version) throw Object.assign(new Error('The signed release is not the version that was offered.'), { code: 'signature' });
    if (manifest.payload_sha256 !== token.package_sha256) throw Object.assign(new Error('The package does not match its signed description.'), { code: 'signature' });

    const mode = getMode();
    const compat = compatibilityProblem({ manifest, currentVersion: getCurrentVersion(), highest: rel.highestVersion(dirs), electronMajor, mode, hostContract: mode === 'remote' ? await hostContract() : null });
    if (!compat.ok) throw Object.assign(new Error(compat.problem), { code: compat.code });

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

  // ------------------------------------------------------------------ the one way an install starts
  /** Called only from the client's click. Approve, download, verify, then hand over to the separate process. */
  async function updateNow() {
    const offer = state.offer;
    if (!offer) return { ok: false, error: 'There is no update to install.' };
    if (state.phase === 'downloading' || state.phase === 'verifying' || state.phase === 'installing') return { ok: false, error: 'The update is already running.' };

    state.phase = 'downloading';
    state.error = null;
    state.progress = null;
    try {
      const decided = await request('POST', `/updates/client/targets/${offer.target_id}/decision`, { body: { decision: 'approve' } });
      if (!decided.ok) throw Object.assign(new Error(describeHttp(decided, 'The update service refused the approval.')), { code: decided.json?.code || 'approve' });

      let obtained = await obtainPackage(offer, state.installUnknown);
      if (obtained.needsFull) {
        state.phase = 'downloading';
        obtained = await obtainPackage(offer, true);
        if (obtained.needsFull) throw Object.assign(new Error('The full recovery package could not be used.'), { code: 'package' });
      }

      state.phase = 'installing';
      const jobFile = writeJob(dirs, { ...obtained.job, parent_pid: process.pid });
      log('INFO', `Handing over to the update bootstrapper for ${offer.version}`);
      await startBootstrap(jobFile);
      return { ok: true };
    } catch (err) {
      log('ERROR', `Update stopped before anything changed [${err.code || 'error'}]: ${err.message}`);
      state.phase = 'idle';
      state.error = err.code === undefined ? 'The update could not continue. Your software was not changed.' : err.message;
      enqueue(offer.target_id, 'FAILED', { category: err.code === 'download' || err.code === 'signature' || err.code === 'package' ? 'download' : 'install', message: String(err.message).slice(0, 900), details: { code: err.code || 'error' } });
      await flushOutbox().catch(() => undefined);
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
    const lastResult = readJsonOr(path.join(dirs.state, 'last-result.json'));
    const offer = state.offer;
    return {
      enabled: Object.keys(trusted || {}).length > 0 && !updateUrlProblem(serverUrl()),
      blocked: state.blocked || (Object.keys(trusted || {}).length === 0 ? 'No trusted signing key is configured, so updates are disabled.' : updateUrlProblem(serverUrl())),
      enrolled: Boolean(device?.token_enc),
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
      lastResult,
      recoveryPoints: listRecoveryPoints(dirs.recovery).length,
    };
  }

  function start() {
    if (timer) return;
    const tick = () => check().catch((err) => log('WARN', `Update check failed: ${err.message}`));
    setTimeout(tick, Number(process.env.FOODCOURT_UPDATE_FIRST_CHECK_MS) || FIRST_CHECK_DELAY_MS).unref();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
    timer.unref();
    flushOutbox().catch(() => undefined);
  }

  return { enroll, check, updateNow, remindLater, reject, confirmTrial, flushOutbox, publicState, start, downloadPayload, obtainPackage, completionProof };
}

module.exports = { createUpdateAgent, updateUrlProblem, compatibilityProblem };
