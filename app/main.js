'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell, systemPreferences } = require('electron');
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
if (process.env.DUCK_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.DUCK_DEBUG_PORT);

let exitCode = EXIT_CANCEL;

function createWindow() {
  const win = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: false,
    title: 'Rubber Duck Gate',
    backgroundColor: '#14181f',
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

// Shows the macOS prompt the first time. Resolves false if access is refused.
ipcMain.handle('gate:camera-access', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true;
  return systemPreferences.askForMediaAccess('camera');
});

ipcMain.handle('gate:config', () => ({
  apiKey: readApiKey(),
  reason: process.env.DUCK_REASON || 'explain yourself',
  simulate: process.env.DUCK_SIMULATE || '',
  debug: process.env.DUCK_DEBUG === '1',
}));

ipcMain.on('gate:finish', (_event, outcome) => {
  exitCode = outcome === 'passed' || outcome === 'skipped' ? EXIT_ALLOW : EXIT_CANCEL;
  if (process.env.DUCK_RESULT_FILE && exitCode === EXIT_ALLOW) {
    fs.writeFileSync(process.env.DUCK_RESULT_FILE, 'allow');
  }
  app.quit();
});

ipcMain.on('gate:camera-settings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
});

ipcMain.on('gate:trace', (_event, line) => {
  if (process.env.DUCK_DEBUG === '1') console.error(line);
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
