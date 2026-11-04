'use strict';
/**
 * Strict validation of everything the renderer sends to the printing service. The renderer is treated as untrusted
 * input: unknown fields are dropped, strings and counts are capped, enums are checked. Nothing here trusts a path,
 * a command, or a script from the renderer; the only things a renderer can supply are text, numbers and choices.
 */
const { CODEPAGE_NAMES } = require('./codepages.cjs');

class PrintValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrintValidationError';
    this.code = 'INVALID';
  }
}

const fail = (msg) => {
  throw new PrintValidationError(msg);
};

const MAX_BLOCKS = 600;
const MAX_TEXT = 800;
const MAX_QR = 900;
const MAX_QR_SIDE = 177; // QR version 40

const str = (v, max, what) => {
  if (typeof v !== 'string') fail(`${what} must be text`);
  if (v.length > max) fail(`${what} is too long`);
  // strip control characters other than newline
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
};

const ALIGN = new Set(['left', 'center', 'right']);

function validateBlock(b, i) {
  if (!b || typeof b !== 'object') fail(`block ${i} is not an object`);
  switch (b.t) {
    case 'text': {
      const out = { t: 'text', text: str(b.text, MAX_TEXT, `block ${i} text`) };
      if (b.align !== undefined) out.align = ALIGN.has(b.align) ? b.align : fail(`block ${i} align`);
      if (b.bold !== undefined) out.bold = b.bold === true;
      if (b.size !== undefined) out.size = b.size === 'large' ? 'large' : b.size === 'normal' ? 'normal' : fail(`block ${i} size`);
      return out;
    }
    case 'row': {
      const out = { t: 'row', left: str(b.left, MAX_TEXT, `block ${i} left`), right: str(b.right, 80, `block ${i} right`) };
      if (b.bold !== undefined) out.bold = b.bold === true;
      return out;
    }
    case 'rule':
      return { t: 'rule', style: b.style === 'double' ? 'double' : 'dash' };
    case 'qr': {
      const out = { t: 'qr', data: str(b.data, MAX_QR, `block ${i} QR data`) };
      if (!out.data) fail(`block ${i} QR data is empty`);
      if (b.modules !== undefined) {
        if (!Array.isArray(b.modules) || b.modules.length < 17 || b.modules.length > MAX_QR_SIDE) fail(`block ${i} QR size`);
        const n = b.modules.length;
        out.modules = b.modules.map((row) => {
          if (typeof row !== 'string' || row.length !== n || /[^01]/.test(row)) fail(`block ${i} QR rows must be square 0/1 strings`);
          return row;
        });
      }
      return out;
    }
    case 'feed': {
      const n = Number(b.lines);
      if (!Number.isInteger(n) || n < 0 || n > 10) fail(`block ${i} feed`);
      return { t: 'feed', lines: n };
    }
    default:
      return fail(`block ${i} has an unknown type`);
  }
}

const KINDS = new Set(['receipt', 'kot', 'test']);

function validateDocument(doc) {
  if (!doc || typeof doc !== 'object') fail('Document is missing');
  if (!KINDS.has(doc.kind)) fail('Unknown document kind');
  if (!Array.isArray(doc.blocks) || doc.blocks.length === 0) fail('Document has no content');
  if (doc.blocks.length > MAX_BLOCKS) fail('Document is too long');
  return { kind: doc.kind, title: typeof doc.title === 'string' ? doc.title.slice(0, 80) : '', blocks: doc.blocks.map(validateBlock) };
}

const ROLES = new Set(['receipt', 'kot']);

/** Printer profile: how one printer role is reached. `dialog` (legacy page print) exists for receipts only. */
const TRANSPORTS = { receipt: ['dialog', 'driver', 'spooler-raw', 'network'], kot: ['none', 'driver', 'spooler-raw', 'network'] };

const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/i;

function validateProfile(role, p) {
  if (!ROLES.has(role)) fail('Unknown printer role');
  if (!p || typeof p !== 'object') fail('Printer settings are missing');
  const transport = TRANSPORTS[role].includes(p.transport) ? p.transport : fail(`Unsupported connection type for the ${role} printer`);
  const out = {
    transport,
    printerName: typeof p.printerName === 'string' ? p.printerName.trim().slice(0, 200) : '',
    host: typeof p.host === 'string' ? p.host.trim().slice(0, 253) : '',
    port: p.port === undefined || p.port === '' ? 9100 : Number(p.port),
    paperWidthMm: Number(p.paperWidthMm) === 58 ? 58 : 80,
    codepage: CODEPAGE_NAMES.includes(p.codepage) ? p.codepage : 'CP858',
    columns: p.columns === null || p.columns === undefined || p.columns === '' ? null : Number(p.columns),
    cut: p.cut !== false,
  };
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) fail('Printer port must be 1-65535');
  if (out.columns !== null && (!Number.isInteger(out.columns) || out.columns < 20 || out.columns > 64)) fail('Columns must be 20-64 (or blank)');
  if (transport === 'network') {
    if (!out.host) fail('Enter the printer address (for example 192.168.1.50)');
    if (!HOST_RE.test(out.host)) fail('The printer address is not valid');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(out.host) && out.host.split('.').some((n) => Number(n) > 255)) fail('The printer address is not valid');
  }
  if ((transport === 'driver' || transport === 'spooler-raw') && !out.printerName) fail('Choose a Windows printer');
  return out;
}

function validateConfig(c) {
  if (!c || typeof c !== 'object') fail('Settings are missing');
  const a = c.autoPrint && typeof c.autoPrint === 'object' ? c.autoPrint : {};
  return {
    receipt: validateProfile('receipt', c.receipt),
    kot: validateProfile('kot', c.kot),
    autoPrint: { kotOnNewTicket: a.kotOnNewTicket === true },
  };
}

const KEY_RE = /^[A-Za-z0-9:_.\-#]{1,120}$/;

function validateReference(r) {
  const o = r && typeof r === 'object' ? r : {};
  const id = (v) => (v === undefined || v === null ? null : Number.isInteger(v) && v >= 0 ? v : fail('Reference ids must be whole numbers'));
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return { orderId: id(o.orderId), ticketId: id(o.ticketId), stallId: id(o.stallId), orderNumber: text(o.orderNumber, 40), ticketNumber: text(o.ticketNumber, 40), stallName: text(o.stallName, 80) };
}

function validateEnqueue(input) {
  if (!input || typeof input !== 'object') fail('Print request is missing');
  const doc = validateDocument(input.doc);
  const role = ROLES.has(input.role) ? input.role : fail('Unknown printer role');
  if (doc.kind === 'receipt' && role !== 'receipt') fail('A receipt prints on the receipt printer');
  if (doc.kind === 'kot' && role !== 'kot') fail('A kitchen ticket prints on the kitchen printer');
  const dedupeKey = input.dedupeKey === undefined || input.dedupeKey === null || input.dedupeKey === '' ? null : KEY_RE.test(String(input.dedupeKey)) ? String(input.dedupeKey) : fail('Invalid duplicate-protection key');
  return { doc, role, kind: doc.kind, dedupeKey, reprint: input.reprint === true, reference: validateReference(input.reference) };
}

module.exports = { PrintValidationError, validateDocument, validateProfile, validateConfig, validateEnqueue, validateReference, TRANSPORTS, MAX_BLOCKS };
