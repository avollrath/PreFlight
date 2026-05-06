import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('preflight', {
  platform: process.platform
});
