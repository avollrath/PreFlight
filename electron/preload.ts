import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('preflight', {
  platform: process.platform,
  unlock: () => ipcRenderer.invoke('preflight:unlock'),
  getState: () => ipcRenderer.invoke('preflight:get-state'),
  setCompletion: (itemId: string, completed: boolean) =>
    ipcRenderer.invoke('preflight:set-completion', itemId, completed),
  saveItems: (texts: string[]) => ipcRenderer.invoke('preflight:save-items', texts)
});
