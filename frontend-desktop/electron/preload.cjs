/**
 * Preload bridge: the ONLY API the renderer gets from Electron. No Node, no ipcRenderer, no fs.
 * Each function maps to one allowlisted channel in main.cjs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  setApiBaseUrl: (url) => ipcRenderer.invoke('desktop:set-api-base-url', String(url)),
  useBuiltInServer: () => ipcRenderer.invoke('desktop:use-builtin-server'),
  testConnection: (url) => ipcRenderer.invoke('desktop:test-connection', String(url)),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  log: (level, message) => ipcRenderer.invoke('desktop:log', String(level), String(message).slice(0, 2000)),
  listPrinters: () => ipcRenderer.invoke('desktop:list-printers'),
  print: (options) => ipcRenderer.invoke('desktop:print', options && typeof options === 'object' ? { deviceName: options.deviceName } : {}),
});
