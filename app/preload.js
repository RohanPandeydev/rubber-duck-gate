'use strict';

const { contextBridge, ipcRenderer } = require('electron');
require('@smartspectra/node-sdk/preload');

contextBridge.exposeInMainWorld('gate', {
  config: () => ipcRenderer.invoke('gate:config'),
  finish: (outcome) => ipcRenderer.send('gate:finish', outcome),
  trace: (line) => ipcRenderer.send('gate:trace', line),
});
