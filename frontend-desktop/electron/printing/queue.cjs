'use strict';
/**
 * The print queue and job lifecycle:   queued -> processing -> completed | failed
 *
 * Rules this class enforces (each has a test in tests/printing-queue.test.ts):
 *  - A job is only `completed` after the transport reports success. A failure is never recorded as success.
 *  - Duplicate protection: enqueueing a key that already has a live or finished job is refused (DUPLICATE) and returns
 *    the existing job. A second paper copy needs an explicit reprint, which is stamped "COPY #n" on the paper.
 *  - Retry is explicit, only for failed jobs, and refused if another job with the same key has since completed.
 *  - Restart: a job that was `processing` when the app closed is marked failed/INTERRUPTED (it may or may not have
 *    printed, so it is NEVER sent again automatically); `queued` jobs resume.
 *  - Jobs run one at a time, in order; one failing job does not block the next.
 */
const crypto = require('node:crypto');
const { validateEnqueue, validateDocument, PrintValidationError } = require('./validate.cjs');
const { encodeDocument, layoutDocument, previewLines, resolveProfile, findUnsupported } = require('./escpos.cjs');
const { documentToHtml } = require('./html.cjs');
const { TransportError } = require('./transports.cjs');

const MARKER = { receipt: (n) => `*** COPY #${n} ***`, kot: (n) => `*** REPRINT #${n} ***`, test: (n) => `*** COPY #${n} ***` };

const isThermal = (profile) => profile.transport === 'network' || profile.transport === 'spooler-raw' || profile.transport === 'driver';

const printerLabel = (p) =>
  p.transport === 'network' ? `Network ${p.host}:${p.port}` : p.transport === 'driver' ? `Windows printer "${p.printerName}"` : p.transport === 'spooler-raw' ? `Windows printer "${p.printerName}" (raw)` : p.transport;

class PrintService {
  /**
   * @param {{store: object, configStore: object, transports: object, log?: Function, onChange?: Function, now?: () => Date, newId?: () => string}} o
   */
  constructor(o) {
    this.store = o.store;
    this.configStore = o.configStore;
    this.t = o.transports;
    this.log = o.log || (() => undefined);
    this.onChange = o.onChange || (() => undefined);
    this.now = o.now || (() => new Date());
    this.newId = o.newId || (() => crypto.randomUUID());
    this.pumping = null;
    this.stopped = false;
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.store.load();
    let interrupted = 0;
    for (const job of this.store.jobs) {
      if (job.status === 'processing') {
        interrupted++;
        this._fail(job, new TransportError('INTERRUPTED', 'The app closed while this was printing. It may or may not have printed: check the paper, then press Retry only if it did not.', { ambiguous: true }));
      }
    }
    if (interrupted) this.log('WARN', `${interrupted} print job(s) were interrupted by the previous shutdown and were not re-sent`);
    if (this.store.jobs.some((j) => j.status === 'queued')) this._kick();
    return this;
  }

  /** Stops accepting new work and waits (briefly) for the job in flight. */
  async shutdown(waitMs = 3000) {
    this.stopped = true;
    if (this.pumping) await Promise.race([this.pumping, new Promise((r) => setTimeout(r, waitMs))]);
  }

  /** Resolves when nothing is queued or running (tests and shutdown). */
  async idle() {
    while (this.pumping) await this.pumping;
  }

  // ---------------------------------------------------------------- public operations
  summarize(job) {
    const { doc, ...rest } = job;
    const later = job.dedupeKey ? this.store.byKey(job.dedupeKey).some((j) => j.id !== job.id && j.status === 'completed' && j.createdAt > job.createdAt) : false;
    return { ...rest, hasDocument: !!doc, canRetry: job.status === 'failed' && !later && !!doc, canReprint: job.status === 'completed' && !!doc };
  }

  list(limit = 100) {
    return this.store.list(Math.min(Math.max(1, Number(limit) || 100), 500)).map((j) => this.summarize(j));
  }

  enqueue(input) {
    let v;
    try {
      v = validateEnqueue(input);
    } catch (err) {
      return this._invalid(err);
    }
    const profile = this.configStore.get()[v.role];
    if (!isThermal(profile)) {
      return { ok: false, code: 'NOT_CONFIGURED', message: v.role === 'kot' ? 'No kitchen printer is set up. Choose one in Settings, Printers.' : 'No thermal receipt printer is set up. Choose one in Settings, Printers.' };
    }

    let copyNumber = 0;
    if (v.dedupeKey) {
      const existing = this.store.byKey(v.dedupeKey);
      if (!v.reprint && existing.length) {
        const live = existing.find((j) => j.status === 'queued' || j.status === 'processing');
        const done = existing.find((j) => j.status === 'completed');
        const failed = existing.find((j) => j.status === 'failed');
        const hit = live || done || failed;
        return { ok: false, code: 'DUPLICATE', reason: live ? 'in-progress' : done ? 'already-printed' : 'failed', job: this.summarize(hit), message: 'This was already sent to the printer.' };
      }
      if (v.reprint) {
        if (existing.some((j) => j.status === 'queued' || j.status === 'processing')) {
          return { ok: false, code: 'DUPLICATE', reason: 'in-progress', job: this.summarize(existing.find((j) => j.status === 'queued' || j.status === 'processing')), message: 'A print of this is already in progress.' };
        }
        copyNumber = 1 + existing.reduce((m, j) => Math.max(m, j.copyNumber || 0), 0);
      }
    }
    const job = this._create({ kind: v.kind, role: v.role, doc: v.doc, reference: v.reference, dedupeKey: v.dedupeKey, copyNumber, profile });
    return { ok: true, job: this.summarize(job) };
  }

  retry(id) {
    const job = this.store.get(id);
    if (!job) return { ok: false, code: 'NOT_FOUND', message: 'That print job no longer exists.' };
    if (job.status !== 'failed') return { ok: false, code: 'NOT_RETRYABLE', message: 'Only a failed job can be retried.' };
    if (!job.doc) return { ok: false, code: 'NOT_RETRYABLE', message: 'This job is too old to retry. Print it again from the order.' };
    if (job.dedupeKey && this.store.byKey(job.dedupeKey).some((j) => j.id !== id && j.status === 'completed' && j.createdAt > job.createdAt)) {
      return { ok: false, code: 'ALREADY_PRINTED', message: 'A later attempt for this already printed. Not retrying, to avoid a duplicate.' };
    }
    const profile = this.configStore.get()[job.role];
    if (!isThermal(profile)) return { ok: false, code: 'NOT_CONFIGURED', message: 'No printer is set up for this. Choose one in Settings, Printers.' };
    const errors = [...(job.errors || []), job.error].filter(Boolean).slice(-5);
    this.store.update(id, { status: 'queued', error: null, errors, completedAt: null, warnings: [] });
    this._emit();
    this._kick();
    return { ok: true, job: this.summarize(this.store.get(id)) };
  }

  /** Another paper copy of a finished job, using the document as it was originally printed. */
  reprint(id) {
    const job = this.store.get(id);
    if (!job) return { ok: false, code: 'NOT_FOUND', message: 'That print job no longer exists.' };
    if (job.status !== 'completed' || !job.doc) return { ok: false, code: 'NOT_REPRINTABLE', message: 'Only a finished job that is still in history can be printed again.' };
    const profile = this.configStore.get()[job.role];
    if (!isThermal(profile)) return { ok: false, code: 'NOT_CONFIGURED', message: 'No printer is set up for this. Choose one in Settings, Printers.' };
    const existing = job.dedupeKey ? this.store.byKey(job.dedupeKey) : [];
    if (existing.some((j) => j.status === 'queued' || j.status === 'processing')) return { ok: false, code: 'DUPLICATE', reason: 'in-progress', message: 'A print of this is already in progress.' };
    const copyNumber = 1 + [job, ...existing].reduce((m, j) => Math.max(m, j.copyNumber || 0), 0);
    const copy = this._create({ kind: job.kind, role: job.role, doc: job.doc, reference: job.reference, dedupeKey: job.dedupeKey, copyNumber, profile });
    return { ok: true, job: this.summarize(copy) };
  }

  /** What the page will look like on the current printer profile, from the same layout the printer receives. */
  preview(docInput, role) {
    let doc;
    try {
      doc = validateDocument(docInput);
    } catch (err) {
      return this._invalid(err);
    }
    const profile = this.configStore.get()[role === 'kot' ? 'kot' : 'receipt'];
    if (profile.transport === 'driver') return { ok: true, mode: 'html', paperWidthMm: profile.paperWidthMm, html: documentToHtml(doc, profile.paperWidthMm, { inline: true }), unsupported: [] };
    if (profile.transport === 'network' || profile.transport === 'spooler-raw') {
      const layout = layoutDocument(doc, profile);
      return { ok: true, mode: 'text', columns: layout.profile.columns, paperWidthMm: layout.profile.paperWidthMm, lines: previewLines(layout), unsupported: findUnsupported(doc, layout.profile.codepage) };
    }
    return { ok: true, mode: 'none' };
  }

  status(role) {
    return this.t.status(this.configStore.get()[role === 'kot' ? 'kot' : 'receipt']);
  }

  sendTest(role) {
    const r = role === 'kot' ? 'kot' : 'receipt';
    const profile = this.configStore.get()[r];
    if (!isThermal(profile)) return { ok: false, code: 'NOT_CONFIGURED', message: 'Choose a printer first, save, then run the test.' };
    const job = this._create({ kind: 'test', role: r, doc: buildTestDocument(r, profile), reference: { orderId: null, ticketId: null, stallId: null, orderNumber: '', ticketNumber: '', stallName: '' }, dedupeKey: null, copyNumber: 0, profile });
    return { ok: true, job: this.summarize(job) };
  }

  // ---------------------------------------------------------------- internals
  _invalid(err) {
    if (err instanceof PrintValidationError) return { ok: false, code: 'INVALID', message: err.message };
    throw err;
  }

  _create({ kind, role, doc, reference, dedupeKey, copyNumber, profile }) {
    const job = {
      id: this.newId(),
      kind,
      role,
      status: 'queued',
      createdAt: this.now().toISOString(),
      startedAt: null,
      completedAt: null,
      attempts: 0,
      error: null,
      errors: [],
      warnings: [],
      reference,
      dedupeKey,
      copyNumber,
      printer: printerLabel(profile),
      doc,
    };
    this.store.add(job);
    this._emit();
    this._kick();
    return job;
  }

  _emit() {
    try {
      this.onChange(this.list(50));
    } catch (err) {
      this.log('WARN', `Print change listener failed: ${err.message}`);
    }
  }

  _kick() {
    if (this.pumping || this.stopped) return;
    this.pumping = (async () => {
      // yield once so enqueue() returns the queued job before work starts
      await new Promise((r) => setImmediate(r));
      try {
        for (;;) {
          const next = this.store.jobs.find((j) => j.status === 'queued');
          if (!next || this.stopped) break;
          await this._run(next);
        }
      } finally {
        this.pumping = null;
      }
    })();
  }

  _fail(job, err) {
    const code = err && err.code ? err.code : 'UNKNOWN';
    const message = err instanceof Error ? err.message : String(err);
    this.store.update(job.id, {
      status: 'failed',
      completedAt: this.now().toISOString(),
      error: { code, message, ambiguous: !!(err && err.ambiguous), at: this.now().toISOString() },
    });
    this.log('WARN', `Print job ${job.id} (${job.kind}) failed: ${code} ${message}`);
    this._emit();
  }

  /** Marker lines are applied here, not stored, so the original document stays reusable for another copy. */
  _materialize(job) {
    if (!job.copyNumber) return job.doc;
    const text = (MARKER[job.kind] || MARKER.receipt)(job.copyNumber);
    return { ...job.doc, blocks: [{ t: 'text', text, align: 'center', bold: true }, { t: 'rule' }, ...job.doc.blocks] };
  }

  async _run(job) {
    const profile = this.configStore.get()[job.role];
    this.store.update(job.id, { status: 'processing', startedAt: this.now().toISOString(), attempts: job.attempts + 1, printer: printerLabel(profile), error: null });
    this._emit();
    try {
      if (!isThermal(profile)) throw new TransportError('NOT_CONFIGURED', 'No printer is set up for this job any more. Choose one in Settings, Printers, then retry.');
      if (!job.doc) throw new TransportError('INVALID', 'The stored document is missing');
      const doc = this._materialize(job);
      const warnings = [];
      if (profile.transport === 'driver') {
        await this.t.printViaDriver(profile.printerName, documentToHtml(doc, profile.paperWidthMm), profile.paperWidthMm);
      } else {
        const encoded = encodeDocument(doc, resolveProfile(profile));
        if (encoded.unsupported.length) {
          warnings.push(`These characters cannot be printed in thermal text mode and came out as "?": ${encoded.unsupported.join(' ')}. Choose "Windows printer (driver)" for Marathi/Devanagari.`);
        }
        if (profile.transport === 'network') await this.t.sendNetwork({ host: profile.host, port: profile.port }, encoded.buffer);
        else await this.t.sendSpoolerRaw(profile.printerName, encoded.buffer);
      }
      this.store.update(job.id, { status: 'completed', completedAt: this.now().toISOString(), error: null, warnings });
      this._emit();
    } catch (err) {
      this._fail(this.store.get(job.id) || job, err);
    }
  }
}

/** Test-print content: column ruler (shows the real line width), code-page sample, and what each transport can do. */
function buildTestDocument(role, profile) {
  const r = resolveProfile(profile);
  const ruler = Array.from({ length: r.columns }, (_, i) => String((i + 1) % 10)).join('');
  const blocks = [
    { t: 'text', text: role === 'kot' ? 'KITCHEN PRINTER TEST' : 'RECEIPT PRINTER TEST', align: 'center', bold: true, size: 'large' },
    { t: 'rule' },
    { t: 'row', left: 'Paper width', right: `${profile.paperWidthMm} mm` },
    { t: 'row', left: 'Connection', right: profile.transport === 'driver' ? 'Windows driver' : profile.transport === 'network' ? 'Network' : 'Windows raw' },
    { t: 'text', text: ruler },
    { t: 'text', text: 'The ruler above should fill exactly one line.' },
    { t: 'rule' },
    { t: 'text', text: 'Accents: áéíóú ñ ü ¿? € Rs.' },
  ];
  if (profile.transport === 'driver') blocks.push({ t: 'text', text: 'मराठी चाचणी (Marathi test)' });
  else blocks.push({ t: 'qr', data: 'FoodCourt printer test' });
  blocks.push({ t: 'row', left: 'Total', right: '123.45', bold: true }, { t: 'rule', style: 'double' }, { t: 'text', text: 'If the paper was cut, the cutter works.', align: 'center' }, { t: 'feed', lines: 1 });
  return { kind: 'test', title: 'Printer test', blocks };
}

module.exports = { PrintService, buildTestDocument, printerLabel, isThermal };
