'use strict';

const { contextBridge, ipcRenderer } = require('electron');
require('@smartspectra/node-sdk/preload');

contextBridge.exposeInMainWorld('gate', {
  config: () => ipcRenderer.invoke('gate:config'),
  cameraAccess: () => ipcRenderer.invoke('gate:camera-access'),
  openCameraSettings: () => ipcRenderer.send('gate:camera-settings'),
  finish: (outcome) => ipcRenderer.send('gate:finish', outcome),
  trace: (line) => ipcRenderer.send('gate:trace', line),
});
