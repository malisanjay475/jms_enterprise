'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jms', {
  getConfig:       ()    => ipcRenderer.invoke('get-config'),
  saveConfig:      (cfg) => ipcRenderer.invoke('save-config', cfg),
  getStatus:       ()    => ipcRenderer.invoke('get-status'),
  checkPostgres:   ()    => ipcRenderer.invoke('check-postgres'),
  installAndStart: (cfg) => ipcRenderer.invoke('install-and-start', cfg),
  openLogs:        ()    => ipcRenderer.invoke('open-logs'),
});
