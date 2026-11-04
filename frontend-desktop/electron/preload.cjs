/**
 * Preload bridge: the ONLY API the renderer gets from Electron. No Node, no ipcRenderer, no fs.
 * Each function maps to one allowlisted channel in main.cjs (BRIDGE_KEYS there must match this list).
 * There is deliberately no way to type or set a server address.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  getStartupStatus: () => ipcRenderer.invoke('desktop:get-startup-status'),
  retryStart: () => ipcRenderer.invoke('desktop:retry-start'),
  useBuiltInServer: () => ipcRenderer.invoke('desktop:use-builtin-server'),
  connectToHost: (pairingString) => ipcRenderer.invoke('desktop:connect-to-host', String(pairingString).slice(0, 700)),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getDiagnostics: () => ipcRenderer.invoke('desktop:get-diagnostics'),
  getBackupStatus: () => ipcRenderer.invoke('desktop:get-backup-status'),
  backupNow: () => ipcRenderer.invoke('desktop:backup-now'),
  chooseBackupFolder: () => ipcRenderer.invoke('desktop:choose-backup-folder'),
  restoreBackup: (name) => ipcRenderer.invoke('desktop:restore-backup', typeof name === 'string' ? name : null),
  log: (level, message) => ipcRenderer.invoke('desktop:log', String(level), String(message).slice(0, 2000)),
  listPrinters: () => ipcRenderer.invoke('desktop:list-printers'),
  print: (options) => ipcRenderer.invoke('desktop:print', options && typeof options === 'object' ? { deviceName: options.deviceName } : {}),
  // Thermal printing (electron/printing/*). Inputs are validated again in the main process.
  getPrintConfig: () => ipcRenderer.invoke('printing:get-config'),
  setPrintConfig: (config) => ipcRenderer.invoke('printing:set-config', config),
  getPrinterStatus: (role) => ipcRenderer.invoke('printing:status', role === 'kot' ? 'kot' : 'receipt'),
  enqueuePrintJob: (request) => ipcRenderer.invoke('printing:enqueue', request),
  listPrintJobs: (limit) => ipcRenderer.invoke('printing:jobs', typeof limit === 'number' ? limit : 100),
  retryPrintJob: (id) => ipcRenderer.invoke('printing:retry', String(id)),
  reprintPrintJob: (id) => ipcRenderer.invoke('printing:reprint', String(id)),
  previewPrintDocument: (request) => ipcRenderer.invoke('printing:preview', request),
  sendTestPrint: (role) => ipcRenderer.invoke('printing:test', role === 'kot' ? 'kot' : 'receipt'),
  onPrintJobsChanged: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, jobs) => callback(jobs);
    ipcRenderer.on('printing:jobs-changed', listener);
    return () => ipcRenderer.removeListener('printing:jobs-changed', listener);
  },
});
