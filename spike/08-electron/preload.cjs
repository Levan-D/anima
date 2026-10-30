const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spike', { log: (message) => ipcRenderer.send('log', message) });
