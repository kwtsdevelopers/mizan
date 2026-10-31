// Mizan POS - Electron preload.
// contextIsolation is on and nodeIntegration is off; the renderer gets only
// this minimal, explicit bridge.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mizanDesktop', {
  version: process.versions.electron,
  platform: process.platform,
});
