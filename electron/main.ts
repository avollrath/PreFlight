import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getChecklistState,
  saveChecklistItems,
  setChecklistItemCompletion
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let locked = true;

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: 'PreFlight',
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.on('close', (event) => {
    if (locked) {
      event.preventDefault();
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  mainWindow.on('blur', () => {
    if (locked) {
      setTimeout(() => {
        mainWindow?.show();
        mainWindow?.focus();
      }, 100);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (locked && input.alt && input.key.toLowerCase() === 'f4') {
      event.preventDefault();
      mainWindow?.focus();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.setFullScreen(true);
    mainWindow?.focus();
  });
}

app.whenReady().then(createWindow);

ipcMain.handle('preflight:unlock', () => {
  locked = false;
  mainWindow?.hide();
  return true;
});

ipcMain.handle('preflight:get-state', () => getChecklistState());

ipcMain.handle('preflight:set-completion', (_event, itemId: string, completed: boolean) =>
  setChecklistItemCompletion(itemId, completed)
);

ipcMain.handle('preflight:save-items', (_event, texts: string[]) => saveChecklistItems(texts));

ipcMain.handle('preflight:get-startup-enabled', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('preflight:set-startup-enabled', (_event, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });

  return app.getLoginItemSettings().openAtLogin;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
