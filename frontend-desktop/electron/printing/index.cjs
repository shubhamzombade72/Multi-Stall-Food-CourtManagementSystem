'use strict';
/**
 * Wires the printing service into Electron: owns the files under userData/printing, builds the hidden print window,
 * and exposes the allow-listed IPC channels. All native printer work happens here in the main process; the renderer
 * can only send validated documents and choices (see validate.cjs) and receive job summaries.
 */
const path = require('node:path');
const crypto = require('node:crypto');
const { ConfigStore } = require('./config.cjs');
const { JobStore } = require('./job-store.cjs');
const { PrintService } = require('./queue.cjs');
const { createTransports } = require('./transports.cjs');
const { validateConfig, PrintValidationError } = require('./validate.cjs');

const CHANNELS = {
  getConfig: 'printing:get-config',
  setConfig: 'printing:set-config',
  status: 'printing:status',
  enqueue: 'printing:enqueue',
  jobs: 'printing:jobs',
  retry: 'printing:retry',
  reprint: 'printing:reprint',
  preview: 'printing:preview',
  test: 'printing:test',
  changed: 'printing:jobs-changed',
};

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const roleOf = (v) => (v === 'kot' ? 'kot' : 'receipt');

/**
 * @param {{app: object, BrowserWindow: Function, handle: Function, getWindows: () => Array, log: Function, listPrinters: () => Promise<Array>}} deps
 */
function createPrinting(deps) {
  const dir = path.join(deps.app.getPath('userData'), 'printing');
  const configStore = new ConfigStore({ file: path.join(dir, 'config.json'), log: deps.log }).load();
  const store = new JobStore({ file: path.join(dir, 'jobs.json'), log: deps.log });

  const createPrintWindow = () => {
    // A throw-away window with its own empty session: no preload, no Node, no navigation, no new windows.
    const win = new deps.BrowserWindow({
      show: false,
      width: 600,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, partition: `print-${crypto.randomBytes(4).toString('hex')}` },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    return {
      async loadHtml(html) {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        await win.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true');
      },
      contentHeight: () => win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'),
      print(opts, cb) {
        win.webContents.print(
          { silent: true, printBackground: true, deviceName: opts.deviceName, margins: { marginType: 'none' }, pageSize: { width: opts.widthMicrons, height: opts.heightMicrons } },
          cb,
        );
      },
      destroy: () => win.destroy(),
    };
  };

  const transports = createTransports({ listPrinters: deps.listPrinters, createPrintWindow, workDir: path.join(dir, 'work') });

  const service = new PrintService({
    store,
    configStore,
    transports,
    log: deps.log,
    onChange: (jobs) => {
      for (const w of deps.getWindows()) {
        if (!w.isDestroyed()) w.webContents.send(CHANNELS.changed, jobs);
      }
    },
  });

  const invalid = (err) => {
    if (err instanceof PrintValidationError) return { ok: false, code: 'INVALID', message: err.message };
    throw err;
  };

  function registerIpc() {
    const h = deps.handle;
    h(CHANNELS.getConfig, () => configStore.get());
    h(CHANNELS.setConfig, (_e, input) => {
      try {
        const config = configStore.set(validateConfig(input));
        deps.log('INFO', `Printing settings saved (receipt: ${config.receipt.transport}, kitchen: ${config.kot.transport})`);
        return { ok: true, config };
      } catch (err) {
        return invalid(err);
      }
    });
    h(CHANNELS.status, (_e, role) => service.status(roleOf(role)));
    h(CHANNELS.enqueue, (_e, input) => service.enqueue(input));
    h(CHANNELS.jobs, (_e, limit) => service.list(Number(limit) || 100));
    h(CHANNELS.retry, (_e, id) => (isId(id) ? service.retry(id) : { ok: false, code: 'INVALID', message: 'Invalid job' }));
    h(CHANNELS.reprint, (_e, id) => (isId(id) ? service.reprint(id) : { ok: false, code: 'INVALID', message: 'Invalid job' }));
    h(CHANNELS.preview, (_e, input) => service.preview(input && input.doc, input && input.role));
    h(CHANNELS.test, (_e, role) => service.sendTest(roleOf(role)));
  }

  return {
    service,
    configStore,
    registerIpc,
    start: () => service.start(),
    shutdown: () => service.shutdown(),
  };
}

module.exports = { createPrinting, CHANNELS };
