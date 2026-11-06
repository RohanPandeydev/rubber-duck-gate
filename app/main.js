'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

const ROOT = path.resolve(__dirname, '..');
const EXIT_ALLOW = 0;
const EXIT_CANCEL = 1;

function readApiKey() {
  if (process.env.SMARTSPECTRA_API_KEY) return process.env.SMARTSPECTRA_API_KEY.trim();
  try {
    const match = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^SMARTSPECTRA_API_KEY=(.*)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

// Lets scripts/ui-check.js drive this window. Off unless asked for.
if (process.env.BREATHE_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.BREATHE_DEBUG_PORT);

let exitCode = EXIT_CANCEL;

function createWindow() {
  const win = new BrowserWindow({
    width: 560,
    height: 720,
    resizable: false,
    title: 'Breathe before you push',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'dist/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  bindSmartSpectraIpc(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('gate:config', () => ({
  apiKey: readApiKey(),
  reason: process.env.BREATHE_REASON || 'take a moment',
  simulate: process.env.BREATHE_SIMULATE || '',
  debug: process.env.BREATHE_DEBUG === '1',
}));

ipcMain.on('gate:finish', (_event, outcome) => {
  exitCode = outcome === 'passed' || outcome === 'skipped' ? EXIT_ALLOW : EXIT_CANCEL;
  app.quit();
});

ipcMain.on('gate:trace', (_event, line) => {
  if (process.env.BREATHE_DEBUG === '1') console.error(line);
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details?.requestingUrl || contents?.getURL() || '';
    const media = details?.mediaTypes || [];
    callback(permission === 'media' && media.length === 1 && media[0] === 'video' && url.startsWith('file://'));
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  process.exitCode = exitCode;
});
app.on('quit', () => app.exit(exitCode));
