/**
 * The release format, shared by the developer's release builder and the client (no Electron imports).
 *
 * A release is: manifest.json (signed as exact bytes), manifest.sig (Ed25519, base64) and a payload. The payload is plain
 * concatenated gzip blocks; the signed manifest says where each file is and what it must hash to. There is no archive to
 * unpack, so a crafted entry name cannot escape: paths come only from the signed manifest and are validated here.
 *
 * Paths are always relative, forward-slash, under `app/` (dist, electron, package.json) or `server/` (php, backend, router.php).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FORMAT = 1;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// ------------------------------------------------------------------ versions
const isValidVersion = (v) => typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(v);

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

// ------------------------------------------------------------------ paths
function isSafeReleasePath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 400) return false;
  if (p.includes('\\') || p.includes(':') || p.includes('\0') || p.startsWith('/')) return false;
  const parts = p.split('/');
  if (parts[0] !== 'app' && parts[0] !== 'server') return false;
  if (parts.length < 2) return false;
  return parts.every((s) => s !== '' && s !== '.' && s !== '..' && !s.endsWith('.') && !s.endsWith(' ') && !WINDOWS_RESERVED.test(s));
}

/** Absolute location of a release path inside `root`, refusing anything that would land outside it. */
function resolveInside(root, relPath) {
  if (!isSafeReleasePath(relPath)) throw new Error(`Unsafe path in release: ${relPath}`);
  const base = path.resolve(root);
  const full = path.resolve(base, ...relPath.split('/'));
  if (!full.startsWith(base + path.sep)) throw new Error(`Path escapes the release folder: ${relPath}`);
  return full;
}

// ------------------------------------------------------------------ hashes
const sha256Buffer = (b) => crypto.createHash('sha256').update(b).digest('hex');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ------------------------------------------------------------------ signatures
function publicKeyFromBase64(b64) {
  const raw = Buffer.from(String(b64), 'base64');
  if (raw.length !== 32) throw new Error('A trusted public key must be 32 bytes.');
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

function signManifest(raw, privateKeyPem) {
  return crypto.sign(null, Buffer.from(raw, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

/** `trusted` is { keyId: base64PublicKey }. An empty list means nothing can verify: updates stay off. */
function verifySignature(raw, signatureB64, keyId, trusted) {
  const key = trusted && Object.prototype.hasOwnProperty.call(trusted, keyId) ? trusted[keyId] : null;
  if (!key) return false;
  try {
    const signature = Buffer.from(String(signatureB64), 'base64');
    if (signature.length !== 64) return false;
    return crypto.verify(null, Buffer.from(raw, 'utf8'), publicKeyFromBase64(key), signature);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ manifest
/** Everything a manifest must satisfy besides its signature. Returns problems; empty means well-formed. */
function manifestProblems(m) {
  const problems = [];
  if (!m || typeof m !== 'object') return ['The manifest could not be read.'];
  if (m.format !== FORMAT) problems.push('The manifest format is not supported.');
  if (typeof m.release_id !== 'string' || !m.release_id) problems.push('The manifest has no release id.');
  if (!isValidVersion(m.version)) problems.push('The manifest version is not valid.');
  if (!['incremental', 'full'].includes(m.package_type)) problems.push('The package type is not valid.');
  if (m.package_type === 'incremental' && !isValidVersion(m.source_version)) problems.push('An incremental package must name a source version.');
  if (!/^[a-f0-9]{64}$/.test(String(m.payload_sha256))) problems.push('The payload hash is not valid.');
  if (!Number.isInteger(m.payload_size) || m.payload_size < 0) problems.push('The payload size is not valid.');
  if (!Array.isArray(m.tree) || m.tree.length === 0) problems.push('The manifest lists no files.');
  if (!Array.isArray(m.files)) problems.push('The manifest lists no payload files.');
  if (problems.length) return problems;

  const seen = new Set();
  for (const f of m.tree) {
    if (!isSafeReleasePath(f.path)) problems.push(`Unsafe path in the file list: ${f.path}`);
    if (!/^[a-f0-9]{64}$/.test(String(f.sha256))) problems.push(`Bad hash for ${f.path}`);
    if (seen.has(String(f.path).toLowerCase())) problems.push(`Listed twice: ${f.path}`);
    seen.add(String(f.path).toLowerCase());
  }
  const byPath = new Map(m.tree.map((f) => [f.path, f]));
  let end = 0;
  for (const f of m.files) {
    const entry = byPath.get(f.path);
    if (!entry) {
      problems.push(`The payload holds a file the release does not list: ${f.path}`);
      continue;
    }
    if (entry.sha256 !== f.sha256 || entry.size !== f.size) problems.push(`The payload entry disagrees with the file list: ${f.path}`);
    if (!Number.isInteger(f.offset) || !Number.isInteger(f.csize) || f.offset < 0 || f.csize < 0) problems.push(`Bad offset for ${f.path}`);
    end = Math.max(end, f.offset + f.csize);
  }
  if (end > m.payload_size) problems.push('The payload is smaller than its file list says.');
  if (m.package_type === 'full' && m.files.length !== m.tree.length) problems.push('A full package must hold every file.');
  return problems;
}

// ------------------------------------------------------------------ payload
/** Writes `files` ([{ path, source }]) as a payload. Returns the entries with hashes, offsets and the payload hash. */
async function writePayload(files, outFile, readSource = (f) => fs.readFileSync(f.source)) {
  const fd = fs.openSync(outFile, 'w');
  const hash = crypto.createHash('sha256');
  const entries = [];
  let offset = 0;
  try {
    for (const file of files) {
      const raw = readSource(file);
      const packed = zlib.gzipSync(raw, { level: 9 });
      fs.writeSync(fd, packed);
      hash.update(packed);
      entries.push({ path: file.path, sha256: sha256Buffer(raw), size: raw.length, offset, csize: packed.length });
      offset += packed.length;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { entries, payload_sha256: hash.digest('hex'), payload_size: offset };
}

/** Reads one file out of an already verified payload and checks its own hash before returning it. */
function readPayloadEntry(payloadFd, entry) {
  const packed = Buffer.alloc(entry.csize);
  if (fs.readSync(payloadFd, packed, 0, entry.csize, entry.offset) !== entry.csize) throw new Error(`The package is truncated at ${entry.path}.`);
  const raw = zlib.gunzipSync(packed);
  if (raw.length !== entry.size || sha256Buffer(raw) !== entry.sha256) throw new Error(`The package holds a damaged copy of ${entry.path}.`);
  return raw;
}

// ------------------------------------------------------------------ atomic writes
/** Write, flush to disk, then rename: after a power cut the file is either the old one or the new one. */
function writeFileDurable(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

const writeJsonDurable = (file, value) => writeFileDurable(file, JSON.stringify(value, null, 2));

function readJsonOr(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = {
  FORMAT,
  isValidVersion,
  compareVersions,
  isSafeReleasePath,
  resolveInside,
  sha256Buffer,
  sha256File,
  publicKeyFromBase64,
  signManifest,
  verifySignature,
  manifestProblems,
  writePayload,
  readPayloadEntry,
  writeFileDurable,
  writeJsonDurable,
  readJsonOr,
};
