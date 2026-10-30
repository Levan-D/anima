/*
 * Throwaway. Does a silent <audio> element plus the Media Session API register
 * an Electron app with the Windows media overlay? Variant comes from argv.
 */
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');

app.setAppUserModelId('com.levan.musicplayer.spike');
const variant = process.argv.find((a) => a.startsWith('--variant='))?.split('=')[1] ?? 'zero-samples';

app.whenReady().then(async () => {
  const keys = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop'];
  if (process.argv.includes('--register-keys')) {
    for (const key of keys) {
      const ok = globalShortcut.register(key, () => console.log(`KEY ${key}`));
      console.log(`globalShortcut ${key}: ${ok}`);
    }
  }
  const win = new BrowserWindow({
    width: 480, height: 320, show: true,
    title: 'Media session spike',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.on('console-message', (event) => console.log(`PAGE ${event.message}`));
  await win.loadFile(path.join(__dirname, 'page.html'), { query: { variant } });
  console.log('READY');
});

ipcMain.on('log', (_event, message) => console.log(`PAGE ${message}`));
