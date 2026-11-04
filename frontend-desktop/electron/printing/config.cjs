'use strict';
/**
 * Per-computer printing configuration (userData/printing/config.json). The receipt printer defaults to `dialog`, the
 * behaviour the app had before this feature (Windows print dialog), so installing the update changes nothing until an
 * operator chooses a thermal printer. The kitchen printer defaults to `none`: paper KOTs are opt-in.
 */
const fs = require('node:fs');
const path = require('node:path');
const { validateConfig } = require('./validate.cjs');

const defaultConfig = () => ({
  receipt: { transport: 'dialog', printerName: '', host: '', port: 9100, paperWidthMm: 80, codepage: 'CP858', columns: null, cut: true },
  kot: { transport: 'none', printerName: '', host: '', port: 9100, paperWidthMm: 80, codepage: 'CP858', columns: null, cut: true },
  autoPrint: { kotOnNewTicket: false },
});

class ConfigStore {
  constructor(opts) {
    this.file = opts.file;
    this.log = opts.log || (() => undefined);
    this.config = defaultConfig();
  }

  load() {
    try {
      this.config = validateConfig(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      if (err && err.code !== 'ENOENT') this.log('WARN', `Printing settings were unreadable (${err.message}); defaults are used`);
      this.config = defaultConfig();
    }
    return this;
  }

  get() {
    return this.config;
  }

  /** Validates, persists atomically, and returns the stored settings. */
  set(input) {
    const next = validateConfig(input);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    this.config = next;
    return next;
  }
}

module.exports = { ConfigStore, defaultConfig };
