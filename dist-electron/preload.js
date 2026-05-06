import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('preflight', {
    platform: process.platform,
    unlock: () => ipcRenderer.invoke('preflight:unlock')
});
