'use strict';
/**
 * Persistent print-job history (userData/printing/jobs.json). Written atomically (temp file + rename) after every
 * change so a crash or power cut leaves either the old or the new file, never half of one. A corrupt file is moved
 * aside and the store starts empty instead of stopping the app.
 *
 * To keep the file small, the stored document is dropped for jobs beyond the newest KEEP_DOCS; their history stays.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_JOBS = 500;
const KEEP_DOCS = 200;

class JobStore {
  /** @param {{file: string, log?: Function}} opts */
  constructor(opts) {
    this.file = opts.file;
    this.log = opts.log || (() => undefined);
    this.jobs = [];
  }

  load() {
    this.jobs = [];
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return this; // first run
    }
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.jobs)) throw new Error('unexpected shape');
      this.jobs = data.jobs.filter((j) => j && typeof j.id === 'string' && typeof j.status === 'string');
    } catch (err) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, aside);
      } catch {
        // nothing more we can do
      }
      this.log('WARN', `Print job history was unreadable (${err.message}); moved to ${path.basename(aside)} and started empty`);
    }
    return this;
  }

  save() {
    this.jobs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    if (this.jobs.length > MAX_JOBS) {
      // never drop a job that is still alive
      const alive = this.jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
      const rest = this.jobs.filter((j) => j.status !== 'queued' && j.status !== 'processing').slice(-(MAX_JOBS - alive.length));
      this.jobs = [...rest, ...alive].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }
    this.jobs.forEach((j, i) => {
      if (i < this.jobs.length - KEEP_DOCS && j.status !== 'queued' && j.status !== 'processing' && j.doc) j.doc = null;
    });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: this.jobs }), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get(id) {
    return this.jobs.find((j) => j.id === id) || null;
  }

  /** Newest first. */
  list(limit = 100) {
    return [...this.jobs].reverse().slice(0, limit);
  }

  add(job) {
    this.jobs.push(job);
    this.save();
    return job;
  }

  update(id, patch) {
    const job = this.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    this.save();
    return job;
  }

  /** Jobs that share a duplicate-protection key, newest first. */
  byKey(key) {
    return this.jobs.filter((j) => j.dedupeKey === key).reverse();
  }
}

module.exports = { JobStore, MAX_JOBS, KEEP_DOCS };
