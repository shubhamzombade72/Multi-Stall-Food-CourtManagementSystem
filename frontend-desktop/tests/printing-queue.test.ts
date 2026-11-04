/**
 * Print queue, job history, restart behaviour and transports. Hardware is replaced by mocks, except the network
 * transport which talks to a real local TCP listener. None of this proves a physical printer works.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { PrintService, buildTestDocument } = require('../electron/printing/queue.cjs');
const { JobStore, KEEP_DOCS } = require('../electron/printing/job-store.cjs');
const { ConfigStore, defaultConfig } = require('../electron/printing/config.cjs');
const { createTransports, TransportError, describeSpoolerStatus, PS_SCRIPT } = require('../electron/printing/transports.cjs');
const { encodeDocument } = require('../electron/printing/escpos.cjs');

const tmp = () => mkdtempSync(join(tmpdir(), 'fc-print-'));
const kotDoc = (n = 'x') => ({ kind: 'kot', title: 'KOT', blocks: [{ t: 'text', text: `2 x Dosa ${n}`, bold: true }] });
const receiptDoc = () => ({ kind: 'receipt', title: 'R', blocks: [{ t: 'text', text: 'Bill: 1' }, { t: 'row', left: 'TOTAL', right: '10.00' }] });
const ref = (o: object = {}) => ({ orderId: 1, ticketId: 5, stallId: 2, orderNumber: 'ORD-1', ticketNumber: 'KKT-1', stallName: 'Dosa', ...o });

/** A transport double that records what was sent and can be told to fail. */
function fakeTransports(opts: { failWith?: () => Error | null } = {}) {
  const sent: { via: string; target: string; buffer?: Buffer; html?: string }[] = [];
  const t = {
    sent,
    failWith: opts.failWith || (() => null),
    async sendNetwork(target: any, buffer: Buffer) {
      const err = t.failWith();
      if (err) throw err;
      sent.push({ via: 'network', target: `${target.host}:${target.port}`, buffer });
    },
    async sendSpoolerRaw(name: string, buffer: Buffer) {
      const err = t.failWith();
      if (err) throw err;
      sent.push({ via: 'spooler-raw', target: name, buffer });
    },
    async printViaDriver(name: string, html: string) {
      const err = t.failWith();
      if (err) throw err;
      sent.push({ via: 'driver', target: name, html });
    },
    async status() {
      return { state: 'ready', message: 'ok', checkedAt: '' };
    },
  };
  return t;
}

function setup(over: { transports?: any; config?: (c: any) => void; dir?: string; now?: () => Date } = {}) {
  const dir = over.dir || tmp();
  const configStore = new ConfigStore({ file: join(dir, 'config.json') }).load();
  const cfg = defaultConfig();
  cfg.receipt = { ...cfg.receipt, transport: 'network', host: '10.0.0.5', port: 9100, paperWidthMm: 80 };
  cfg.kot = { ...cfg.kot, transport: 'network', host: '10.0.0.6', port: 9100, paperWidthMm: 58 };
  over.config?.(cfg);
  configStore.set(cfg);
  const transports = over.transports || fakeTransports();
  const changes: any[] = [];
  let counter = 0;
  const make = () =>
    new PrintService({
      store: new JobStore({ file: join(dir, 'jobs.json') }),
      configStore,
      transports,
      onChange: (jobs: any[]) => changes.push(jobs),
      newId: () => `job-${++counter}`,
      now: over.now,
    });
  return { dir, configStore, transports, changes, svc: make().start(), make };
}

// ------------------------------------------------------------------ lifecycle
test('a job goes queued -> processing -> completed and records printer, times and reference', async () => {
  const { svc, transports, changes } = setup();
  const r = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  assert.equal(r.ok, true);
  assert.equal(r.job.status, 'queued');
  await svc.idle();
  const job = svc.list()[0];
  assert.equal(job.status, 'completed');
  assert.equal(job.attempts, 1);
  assert.ok(job.startedAt && job.completedAt && job.createdAt <= job.startedAt);
  assert.equal(job.printer, 'Network 10.0.0.6:9100');
  assert.equal(job.reference.stallName, 'Dosa');
  assert.equal(job.reference.ticketId, 5);
  assert.equal(transports.sent.length, 1);
  const seen = changes.flatMap((c) => c.map((j: any) => j.status));
  assert.ok(seen.includes('queued') && seen.includes('processing') && seen.includes('completed'), 'every state change is announced');
});

test('the receipt and the kitchen ticket use their own printer and paper width', async () => {
  const { svc, transports } = setup();
  svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:1:paid', reference: ref() });
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  await svc.idle();
  assert.deepEqual(transports.sent.map((s: any) => s.target), ['10.0.0.5:9100', '10.0.0.6:9100']);
  assert.ok(transports.sent[0].buffer.toString('latin1').includes('TOTAL' + ' '.repeat(48 - 'TOTAL'.length - 5) + '10.00'), '80 mm receipt = 48 columns');
  assert.ok(transports.sent[1].buffer.length < 200);
});

test('a failed print is recorded as failed, with the reason, and is never marked completed', async () => {
  const transports = fakeTransports({ failWith: () => new TransportError('UNREACHABLE', 'The printer at 10.0.0.6:9100 did not answer') });
  const { svc } = setup({ transports });
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  await svc.idle();
  const job = svc.list()[0];
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'UNREACHABLE');
  assert.match(job.error.message, /did not answer/);
  assert.equal(job.error.ambiguous, false);
  assert.equal(job.completedAt !== null, true, 'finish time is recorded for the failure');
  assert.equal(transports.sent.length, 0);
  assert.equal(job.canRetry, true);
  assert.equal(job.canReprint, false, 'a failed job cannot be "printed again"');
});

test('unexpected errors (not a TransportError) also end as failed, not as success', async () => {
  const { svc } = setup({ transports: fakeTransports({ failWith: () => new Error('boom') }) });
  svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:1:paid', reference: ref() });
  await svc.idle();
  assert.equal(svc.list()[0].status, 'failed');
  assert.equal(svc.list()[0].error.code, 'UNKNOWN');
});

test('printer disconnected mid-day: the failure is reported, the next job still runs', async () => {
  let down = true;
  const transports = fakeTransports({ failWith: () => (down ? new TransportError('PRINTER_NOT_FOUND', 'The printer "POS-58" is not installed in Windows') : null) });
  const { svc } = setup({ transports });
  svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:1:paid', reference: ref() });
  await svc.idle();
  down = false;
  svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:2:paid', reference: ref({ orderId: 2 }) });
  await svc.idle();
  const byKey = Object.fromEntries(svc.list().map((j: any) => [j.dedupeKey, j.status]));
  assert.deepEqual(byKey, { 'receipt:1:paid': 'failed', 'receipt:2:paid': 'completed' });
});

test('an unconfigured printer is refused up front with a clear reason and creates no job', async () => {
  const { svc } = setup({ config: (c) => (c.kot.transport = 'none') });
  const r = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_CONFIGURED');
  assert.match(r.message, /kitchen printer/i);
  assert.equal(svc.list().length, 0);
  const d = setup({ config: (c) => (c.receipt.transport = 'dialog') });
  assert.equal(d.svc.enqueue({ role: 'receipt', doc: receiptDoc() }).code, 'NOT_CONFIGURED');
});

test('invalid requests never reach a printer', async () => {
  const { svc, transports } = setup();
  assert.equal(svc.enqueue({ role: 'kot', doc: { kind: 'kot', blocks: [] } }).code, 'INVALID');
  assert.equal(svc.enqueue({ role: 'nope', doc: kotDoc() }).code, 'INVALID');
  await svc.idle();
  assert.equal(transports.sent.length, 0);
});

// ------------------------------------------------------------------ duplicates, retry, reprint
test('duplicate protection: the same key is not printed twice (double click, second tablet, repeated poll)', async () => {
  const { svc, transports } = setup();
  const a = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  const b = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  assert.equal(b.code, 'DUPLICATE');
  assert.equal(b.reason, 'in-progress');
  assert.equal(b.job.id, a.job.id);
  await svc.idle();
  const c = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  assert.equal(c.code, 'DUPLICATE');
  assert.equal(c.reason, 'already-printed');
  await svc.idle();
  assert.equal(transports.sent.length, 1, 'exactly one slip');
  assert.equal(svc.list().length, 1);
});

test('different tickets or different paid/bill state are different prints', async () => {
  const { svc, transports } = setup();
  for (const key of ['kot:5', 'kot:6', 'receipt:9:bill', 'receipt:9:paid']) svc.enqueue({ role: key.startsWith('kot') ? 'kot' : 'receipt', doc: key.startsWith('kot') ? kotDoc(key) : receiptDoc(), dedupeKey: key });
  await svc.idle();
  assert.equal(transports.sent.length, 4);
});

test('an explicit reprint prints another copy stamped with its copy number', async () => {
  const { svc, transports } = setup();
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  await svc.idle();
  const second = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reprint: true, reference: ref() });
  assert.equal(second.ok, true);
  assert.equal(second.job.copyNumber, 1);
  await svc.idle();
  const third = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reprint: true, reference: ref() });
  assert.equal(third.job.copyNumber, 2);
  await svc.idle();
  const texts = transports.sent.map((s: any) => s.buffer.toString('latin1'));
  assert.ok(!texts[0].includes('REPRINT'));
  assert.ok(texts[1].includes('*** REPRINT #1 ***'));
  assert.ok(texts[2].includes('*** REPRINT #2 ***'));
  const receiptCopy = setup();
  receiptCopy.svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:1:paid' });
  await receiptCopy.svc.idle();
  receiptCopy.svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:1:paid', reprint: true });
  await receiptCopy.svc.idle();
  assert.ok(receiptCopy.transports.sent[1].buffer.toString('latin1').includes('*** COPY #1 ***'));
});

test('"print another copy" from history reuses the original document and bumps the copy number', async () => {
  const { svc, transports } = setup();
  svc.enqueue({ role: 'receipt', doc: receiptDoc(), dedupeKey: 'receipt:1:paid' });
  await svc.idle();
  const id = svc.list()[0].id;
  const r = svc.reprint(id);
  assert.equal(r.ok, true);
  assert.equal(r.job.copyNumber, 1);
  await svc.idle();
  assert.ok(transports.sent[1].buffer.toString('latin1').includes('Bill: 1'));
  assert.equal(svc.reprint('missing').code, 'NOT_FOUND');
});

test('controlled retry: only failed jobs, one job, no duplicate slip, attempt counted', async () => {
  let fail = true;
  const transports = fakeTransports({ failWith: () => (fail ? new TransportError('UNREACHABLE', 'down') : null) });
  const { svc } = setup({ transports });
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  await svc.idle();
  const id = svc.list()[0].id;
  // a new enqueue of the same key while it failed is answered with the failed job, not a second job
  const dup = svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5' });
  assert.equal(dup.code, 'DUPLICATE');
  assert.equal(dup.reason, 'failed');
  assert.equal(svc.list().length, 1);
  fail = false;
  const r = svc.retry(id);
  assert.equal(r.ok, true);
  await svc.idle();
  const job = svc.list()[0];
  assert.equal(job.status, 'completed');
  assert.equal(job.attempts, 2);
  assert.equal(job.error, null);
  assert.equal(transports.sent.length, 1, 'printed exactly once after the retry');
  assert.equal(svc.retry(id).code, 'NOT_RETRYABLE', 'a finished job cannot be retried');
  assert.equal(svc.retry('nope').code, 'NOT_FOUND');
});

test('retry is refused when a later attempt for the same record already printed (no duplicate paper)', async () => {
  let fail = true;
  const now = { t: Date.parse('2026-11-04T10:00:00Z') };
  const transports = fakeTransports({ failWith: () => (fail ? new TransportError('UNREACHABLE', 'down') : null) });
  const { svc } = setup({ transports, now: () => new Date((now.t += 1000)) });
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5' });
  await svc.idle();
  const failedId = svc.list()[0].id;
  fail = false;
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reprint: true }); // operator chose "print again" instead
  await svc.idle();
  assert.equal(svc.retry(failedId).code, 'ALREADY_PRINTED');
});

test('a retry of a job whose printer was since removed from settings fails clearly instead of guessing', async () => {
  const transports = fakeTransports({ failWith: () => new TransportError('UNREACHABLE', 'down') });
  const { svc, configStore } = setup({ transports });
  svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5' });
  await svc.idle();
  const cfg = configStore.get();
  configStore.set({ ...cfg, kot: { ...cfg.kot, transport: 'none' } });
  assert.equal(svc.retry(svc.list()[0].id).code, 'NOT_CONFIGURED');
});

// ------------------------------------------------------------------ warnings, test print
test('Marathi in thermal text mode completes with a warning that names the lost characters', async () => {
  const { svc } = setup();
  svc.enqueue({ role: 'kot', doc: { kind: 'kot', blocks: [{ t: 'text', text: '1 x डोसा' }] }, dedupeKey: 'kot:7' });
  await svc.idle();
  const job = svc.list()[0];
  assert.equal(job.status, 'completed');
  assert.equal(job.warnings.length, 1);
  assert.match(job.warnings[0], /ड/);
  assert.match(job.warnings[0], /driver/i);
});

test('the Windows-driver transport receives the page, not ESC/POS bytes, and Marathi survives', async () => {
  const { svc, transports } = setup({ config: (c) => Object.assign(c.receipt, { transport: 'driver', printerName: 'POS-80' }) });
  svc.enqueue({ role: 'receipt', doc: { kind: 'receipt', blocks: [{ t: 'text', text: 'मराठी' }] }, dedupeKey: 'receipt:3:paid' });
  await svc.idle();
  assert.equal(transports.sent[0].via, 'driver');
  assert.equal(transports.sent[0].target, 'POS-80');
  assert.ok(transports.sent[0].html.includes('मराठी'));
  assert.deepEqual(svc.list()[0].warnings, []);
});

test('test print: ruler matches the paper width; Marathi sample only for the driver connection', async () => {
  const { svc, transports } = setup();
  assert.equal(svc.sendTest('kot').ok, true);
  await svc.idle();
  const s = transports.sent[0].buffer.toString('latin1');
  assert.ok(s.includes('1234567890'.repeat(3) + '12'), '58 mm ruler is 32 wide');
  assert.ok(!/म/.test(JSON.stringify(buildTestDocument('kot', { transport: 'network', paperWidthMm: 58 }))));
  assert.ok(/म/.test(JSON.stringify(buildTestDocument('kot', { transport: 'driver', paperWidthMm: 58 }))));
  assert.equal(setup({ config: (c) => (c.kot.transport = 'none') }).svc.sendTest('kot').code, 'NOT_CONFIGURED');
});

// ------------------------------------------------------------------ persistence and restart
test('history persists on disk and is reloaded by a new process', async () => {
  const a = setup();
  a.svc.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5', reference: ref() });
  await a.svc.idle();
  const b = a.make().start();
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0].status, 'completed');
  assert.equal(b.list()[0].reference.orderNumber, 'ORD-1');
  const dup = b.enqueue({ role: 'kot', doc: kotDoc(), dedupeKey: 'kot:5' });
  assert.equal(dup.code, 'DUPLICATE', 'duplicate protection survives a restart');
});

test('restart: a job that was mid-print is marked failed/INTERRUPTED and is NOT sent again automatically', async () => {
  const dir = tmp();
  const store = new JobStore({ file: join(dir, 'jobs.json') });
  store.add({ id: 'p1', kind: 'kot', role: 'kot', status: 'processing', createdAt: '2026-11-04T10:00:00.000Z', startedAt: '2026-11-04T10:00:01.000Z', completedAt: null, attempts: 1, error: null, errors: [], warnings: [], reference: ref(), dedupeKey: 'kot:5', copyNumber: 0, printer: 'x', doc: kotDoc() });
  const { svc, transports } = setup({ dir });
  await svc.idle();
  const job = svc.list()[0];
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'INTERRUPTED');
  assert.equal(job.error.ambiguous, true);
  assert.equal(transports.sent.length, 0, 'nothing was re-sent');
  assert.equal(job.canRetry, true, 'the operator may retry after checking the paper');
});

test('restart: queued jobs are not lost; they resume and print once', async () => {
  const dir = tmp();
  const store = new JobStore({ file: join(dir, 'jobs.json') });
  store.add({ id: 'q1', kind: 'kot', role: 'kot', status: 'queued', createdAt: '2026-11-04T10:00:00.000Z', startedAt: null, completedAt: null, attempts: 0, error: null, errors: [], warnings: [], reference: ref(), dedupeKey: 'kot:5', copyNumber: 0, printer: 'x', doc: kotDoc() });
  const { svc, transports } = setup({ dir });
  await svc.idle();
  assert.equal(svc.list()[0].status, 'completed');
  assert.equal(transports.sent.length, 1);
});

test('a corrupt history file is set aside and the app starts with an empty history', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'jobs.json'), '{"jobs": [ {broken');
  const store = new JobStore({ file: join(dir, 'jobs.json') }).load();
  assert.equal(store.list().length, 0);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('jobs.json.corrupt-')));
});

test('history is capped and old documents are dropped, but live jobs are never evicted', () => {
  const dir = tmp();
  const store = new JobStore({ file: join(dir, 'jobs.json') });
  const mk = (i: number, status = 'completed') => ({ id: `j${i}`, status, createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), doc: kotDoc(), dedupeKey: `k${i}` });
  store.jobs = Array.from({ length: 520 }, (_, i) => mk(i));
  store.jobs.push(mk(0.5, 'queued'));
  store.save();
  const saved = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8')).jobs;
  assert.ok(saved.length <= 501);
  assert.ok(saved.some((j: any) => j.status === 'queued'));
  assert.equal(saved.filter((j: any) => j.doc).length <= KEEP_DOCS + 1, true);
});

test('settings are validated on save and survive a restart; defaults keep the old print dialog', () => {
  const dir = tmp();
  const c = new ConfigStore({ file: join(dir, 'config.json') }).load();
  assert.equal(c.get().receipt.transport, 'dialog');
  assert.equal(c.get().kot.transport, 'none');
  assert.equal(c.get().autoPrint.kotOnNewTicket, false);
  assert.throws(() => c.set({ ...c.get(), receipt: { ...c.get().receipt, transport: 'network', host: '' } }), /address/);
  c.set({ ...c.get(), receipt: { ...c.get().receipt, transport: 'network', host: 'printer.local', port: 9100, paperWidthMm: 58 }, autoPrint: { kotOnNewTicket: true } });
  const again = new ConfigStore({ file: join(dir, 'config.json') }).load().get();
  assert.equal(again.receipt.host, 'printer.local');
  assert.equal(again.receipt.paperWidthMm, 58);
  assert.equal(again.autoPrint.kotOnNewTicket, true);
});

// ------------------------------------------------------------------ transports
function listener() {
  return new Promise<{ server: Server; port: number; received: Buffer[]; closed: Promise<void> }>((resolve) => {
    const received: Buffer[] = [];
    let onClosed: () => void = () => undefined;
    const closed = new Promise<void>((r) => (onClosed = r));
    const server = createServer((sock) => {
      sock.on('data', (d) => received.push(d));
      sock.on('close', () => onClosed());
      sock.on('error', () => undefined);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port, received, closed }));
  });
}

test('network transport delivers the exact ESC/POS bytes to a TCP listener (real socket, not a printer)', async () => {
  const l = await listener();
  const t = createTransports({ listPrinters: async () => [], createPrintWindow: () => null });
  const bytes = encodeDocument(receiptDoc(), { paperWidthMm: 80 }).buffer;
  await t.sendNetwork({ host: '127.0.0.1', port: l.port }, bytes);
  await l.closed;
  assert.ok(Buffer.concat(l.received).equals(bytes));
  l.server.close();
});

test('network transport: a closed port is UNREACHABLE and not ambiguous (nothing was sent)', async () => {
  const l = await listener();
  const port = l.port;
  await new Promise((r) => l.server.close(r));
  const t = createTransports({ listPrinters: async () => [], createPrintWindow: () => null });
  await assert.rejects(t.sendNetwork({ host: '127.0.0.1', port }, Buffer.from('x')), (e: any) => e.code === 'UNREACHABLE' && e.ambiguous === false && /refused/.test(e.message));
  const probe = await t.probeNetwork({ host: '127.0.0.1', port });
  assert.equal(probe.reachable, false);
  assert.match(String(probe.error), /refused/);
});

test('network transport: a printer that accepts the connection but never answers times out', async () => {
  const server = createServer((s) => {
    s.on('error', () => undefined);
    s.pause(); // accept and then stall, like a printer with a full buffer
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const t = createTransports({ listPrinters: async () => [], createPrintWindow: () => null, timeouts: { writeMs: 150, connectMs: 150 } });
  // a small payload fits the socket buffers, so it completes; the stall only matters once the printer stops reading a big one
  const big = Buffer.alloc(8 * 1024 * 1024, 0x41);
  await assert.rejects(t.sendNetwork({ host: '127.0.0.1', port }, big), (e: any) => e.code === 'TIMEOUT' && e.ambiguous === true);
  server.close();
});

test('network status reports reachable only for a listening address', async () => {
  const l = await listener();
  const t = createTransports({ listPrinters: async () => [], createPrintWindow: () => null });
  const ok = await t.status({ transport: 'network', host: '127.0.0.1', port: l.port });
  assert.equal(ok.state, 'ready');
  assert.match(ok.message, /does not prove/);
  l.server.close();
  const bad = await t.status({ transport: 'network', host: '127.0.0.1', port: l.port });
  assert.equal(bad.state, 'offline');
  assert.equal((await t.status({ transport: 'none' })).state, 'unconfigured');
  assert.equal((await t.status({ transport: 'network', host: '' })).state, 'unconfigured');
});

test('Windows status flags are decoded: offline, paper out and a cover left open block printing', () => {
  assert.equal(describeSpoolerStatus(0).blocked, false);
  assert.equal(describeSpoolerStatus(0x80).blocked, true);
  assert.match(describeSpoolerStatus(0x80).problems[0].text, /offline/i);
  assert.match(describeSpoolerStatus(0x10).problems[0].text, /paper/i);
  assert.equal(describeSpoolerStatus(0x400000).blocked, true);
  assert.equal(describeSpoolerStatus(0x400).blocked, false, 'merely "printing" is fine');
});

test('Windows queue: a printer that is not installed fails before anything is spawned', async () => {
  let spawned = 0;
  const t = createTransports({ platform: 'win32', listPrinters: async () => [{ name: 'Other', status: 0 }], createPrintWindow: () => null, spawn: () => ((spawned++), {} as any), workDir: tmp() });
  await assert.rejects(t.sendSpoolerRaw('POS-58', Buffer.from('x')), (e: any) => e.code === 'PRINTER_NOT_FOUND');
  await assert.rejects(t.printViaDriver('POS-58', '<p>x</p>', 58), (e: any) => e.code === 'PRINTER_NOT_FOUND');
  assert.equal(spawned, 0);
  assert.equal((await t.status({ transport: 'spooler-raw', printerName: 'POS-58' })).state, 'not-found');
});

test('Windows queue: an offline printer is refused with its reason', async () => {
  const t = createTransports({ platform: 'win32', listPrinters: async () => [{ name: 'POS-58', status: 0x80 }], createPrintWindow: () => null, workDir: tmp() });
  await assert.rejects(t.sendSpoolerRaw('POS-58', Buffer.from('x')), (e: any) => e.code === 'OFFLINE' && /offline/i.test(e.message));
  assert.equal((await t.status({ transport: 'driver', printerName: 'POS-58' })).state, 'offline');
});

test('Windows queue: the helper gets the printer name and file through the environment, never the command line', async () => {
  const dir = tmp();
  let call: any = null;
  const spawnFake = (cmd: string, args: string[], opts: any) => {
    call = { cmd, args, env: opts.env, fileBytes: readFileSync(opts.env.FC_FILE) };
    const child: any = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const t = createTransports({ platform: 'win32', listPrinters: async () => [{ name: 'POS "58"; calc', status: 0 }], createPrintWindow: () => null, spawn: spawnFake, workDir: dir });
  await t.sendSpoolerRaw('POS "58"; calc', Buffer.from([1, 2, 3, 0x1b]));
  assert.equal(call.cmd, 'powershell.exe');
  assert.ok(!call.args.some((a: string) => a.includes('calc')), 'printer name is not in the arguments');
  assert.equal(call.env.FC_PRINTER, 'POS "58"; calc');
  assert.deepEqual([...call.fileBytes], [1, 2, 3, 0x1b]);
  assert.equal(existsSync(call.env.FC_FILE), false, 'temporary job file is removed');
  assert.equal(readFileSync(join(dir, 'rawprint.ps1'), 'utf8'), PS_SCRIPT);
  assert.match(PS_SCRIPT, /pDataType = "RAW"/);
});

test('Windows queue: helper failures map to specific errors; a write failure is flagged ambiguous', async () => {
  const run = async (stderr: string, code = 2) => {
    const spawnFake = () => {
      const child: any = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stderr.emit('data', stderr);
        child.emit('close', code);
      });
      return child;
    };
    const t = createTransports({ platform: 'win32', listPrinters: async () => [{ name: 'P', status: 0 }], createPrintWindow: () => null, spawn: spawnFake, workDir: tmp() });
    return t.sendSpoolerRaw('P', Buffer.from('x')).then(() => null, (e: any) => e);
  };
  const open = await run('ERR:OPEN:1801');
  assert.equal(open.code, 'PRINTER_NOT_FOUND');
  assert.equal(open.ambiguous, false);
  assert.equal((await run('ERR:OPEN:5')).code, 'OFFLINE');
  assert.equal((await run('ERR:START:1722')).code, 'REJECTED');
  const write = await run('ERR:WRITE:995');
  assert.equal(write.code, 'WRITE_FAILED');
  assert.equal(write.ambiguous, true);
});

test('Windows queue is refused on other platforms', async () => {
  const t = createTransports({ platform: 'linux', listPrinters: async () => [], createPrintWindow: () => null });
  await assert.rejects(t.sendSpoolerRaw('P', Buffer.from('x')), (e: any) => e.code === 'UNSUPPORTED_PLATFORM');
});

test('driver transport: page size comes from the paper width and measured height; rejection and timeout are failures', async () => {
  const printed: any[] = [];
  const mkWin = (result: { success: boolean; reason?: string } | 'hang') => () => ({
    loadHtml: async () => undefined,
    contentHeight: async () => 400,
    print: (opts: any, cb: Function) => {
      printed.push(opts);
      if (result !== 'hang') cb(result.success, result.reason);
    },
    destroy: () => printed.push('destroyed'),
  });
  const base = { listPrinters: async () => [{ name: 'POS-58', status: 0 }], workDir: tmp() };
  await createTransports({ ...base, createPrintWindow: mkWin({ success: true }) }).printViaDriver('POS-58', '<p>x</p>', 58);
  assert.equal(printed[0].deviceName, 'POS-58');
  assert.equal(printed[0].widthMicrons, 58000);
  assert.ok(printed[0].heightMicrons > 100000 && printed[0].heightMicrons < 200000);
  assert.equal(printed[1], 'destroyed', 'the hidden window is always closed');
  await assert.rejects(createTransports({ ...base, createPrintWindow: mkWin({ success: false, reason: 'Printer is offline' }) }).printViaDriver('POS-58', '<p>x</p>', 80), (e: any) => e.code === 'REJECTED' && /offline/.test(e.message));
  await assert.rejects(createTransports({ ...base, createPrintWindow: mkWin('hang'), timeouts: { driverMs: 50 } }).printViaDriver('POS-58', '<p>x</p>', 80), (e: any) => e.code === 'TIMEOUT' && e.ambiguous === true);
});

test.after(() => {
  // temp folders are left to the OS; remove the largest to keep CI tidy
  try {
    rmSync(join(tmpdir(), 'fc-test'), { recursive: true, force: true });
  } catch {
    // ignore
  }
});
