import type {
  BrowserWindow as BrowserWindowInstance,
  Event as ElectronEvent,
  Input
} from 'electron';
import path from 'node:path';
import {
  getChecklistState,
  saveChecklistItems,
  setChecklistItemCompletion
} from './store.js';

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  screen
} = require('electron') as typeof import('electron');

const isDev =
  process.env.PREFLIGHT_DEV_SAFE === '1' ||
  process.env.PREFLIGHT_DEV_LOCKED === '1' ||
  Boolean(process.env.VITE_DEV_SERVER_URL) ||
  !app.isPackaged;
const isDebug = process.env.PREFLIGHT_DEV_DEBUG === '1';
const isOverlayMode = !isDebug && (!isDev || process.env.PREFLIGHT_DEV_LOCKED === '1');

let mainWindow: BrowserWindowInstance | null = null;
let locked = isOverlayMode;

function log(message: string, extra?: unknown) {
  if (extra === undefined) {
    console.log(`[PreFlight] ${message}`);
    return;
  }

  console.log(`[PreFlight] ${message}`, extra);
}

function debugLog(message: string, extra?: unknown) {
  if (isDebug) {
    log(message, extra);
  }
}

function fallbackHtml(message: string) {
  const escaped = message.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return replacements[character];
  });

  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>PreFlight Load Error</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #101418;
            color: #f5f7f4;
            font-family: Segoe UI, system-ui, sans-serif;
          }
          main {
            width: min(720px, calc(100vw - 48px));
            border: 1px solid rgba(255,255,255,.14);
            border-radius: 8px;
            padding: 32px;
            background: #151b1f;
          }
          h1 { margin: 0 0 12px; }
          p { color: #b7c0bb; line-height: 1.5; }
          code { color: #ff1744; }
        </style>
      </head>
      <body>
        <main>
          <h1>PreFlight could not load the renderer</h1>
          <p>${escaped}</p>
          <p>Press <code>Ctrl+Shift+U</code> to close this development window.</p>
        </main>
      </body>
    </html>
  `)}`;
}

function emergencyUnlock() {
  log('Emergency unlock requested');
  locked = false;

  if (isDev) {
    app.quit();
    return;
  }

  mainWindow?.hide();
}

function logWindowSafetyState() {
  if (!mainWindow) {
    return;
  }

  log('Window safety state', {
    bounds: mainWindow.getBounds(),
    fullScreen: mainWindow.isFullScreen(),
    alwaysOnTop: mainWindow.isAlwaysOnTop(),
    closable: mainWindow.isClosable(),
    resizable: mainWindow.isResizable(),
    locked
  });
}

function logRendererLayoutState() {
  if (!mainWindow) {
    return;
  }

  void mainWindow.webContents
    .executeJavaScript(
      `({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        html: {
          width: document.documentElement.getBoundingClientRect().width,
          height: document.documentElement.getBoundingClientRect().height
        },
        body: {
          width: document.body.getBoundingClientRect().width,
          height: document.body.getBoundingClientRect().height
        },
        root: {
          width: document.getElementById('root')?.getBoundingClientRect().width,
          height: document.getElementById('root')?.getBoundingClientRect().height
        },
        shell: {
          width: document.querySelector('.app-shell')?.getBoundingClientRect().width,
          height: document.querySelector('.app-shell')?.getBoundingClientRect().height
        },
        panel: {
          width: document.querySelector('.preflight-panel')?.getBoundingClientRect().width,
          height: document.querySelector('.preflight-panel')?.getBoundingClientRect().height
        }
      })`
    )
    .then((layout) => log('Renderer layout state', layout))
    .catch((error) => log('Renderer layout state unavailable', error));
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const primaryDisplayBounds = screen.getPrimaryDisplay().bounds;

  mainWindow = new BrowserWindow({
    x: isOverlayMode ? primaryDisplayBounds.x : undefined,
    y: isOverlayMode ? primaryDisplayBounds.y : undefined,
    width: isOverlayMode ? primaryDisplayBounds.width : 1800,
    height: isOverlayMode ? primaryDisplayBounds.height : 1000,
    minWidth: 900,
    minHeight: 620,
    title: 'PreFlight',
    fullscreen: isOverlayMode,
    frame: !isOverlayMode,
    resizable: !isOverlayMode,
    alwaysOnTop: isOverlayMode,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    show: !isOverlayMode,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isOverlayMode) {
    mainWindow.setBounds(primaryDisplayBounds);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  mainWindow.on('close', (event: ElectronEvent) => {
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

  mainWindow.webContents.on('before-input-event', (event: ElectronEvent, input: Input) => {
    const key = input.key.toLowerCase();

    if (input.control && input.shift && key === 'u') {
      event.preventDefault();
      emergencyUnlock();
      return;
    }

    if (locked && input.alt && key === 'f4') {
      event.preventDefault();
      mainWindow?.focus();
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    const message = `Failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`;
    log(message);
    void mainWindow?.loadURL(fallbackHtml(message));
  });

  mainWindow.webContents.on('did-finish-load', () => {
    debugLog(`Renderer finished loading: ${mainWindow?.webContents.getURL()}`);
    mainWindow?.setTitle('PreFlight');

    if (isOverlayMode || isDebug) {
      logRendererLayoutState();
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('Renderer process exited', details);
  });

  mainWindow.webContents.on('crashed', () => {
    log('Renderer process crashed');
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    debugLog(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
  });

  const rendererTarget = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : path.join(__dirname, '../dist/index.html');

  log(
    process.env.VITE_DEV_SERVER_URL
      ? `Loading renderer URL: ${rendererTarget}`
      : `Loading renderer file: ${rendererTarget}`
  );

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(rendererTarget);
  }

  if (!isOverlayMode) {
    mainWindow.show();
    mainWindow.focus();

    if (isDebug) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      logWindowSafetyState();
    }
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();

    if (isOverlayMode) {
      mainWindow?.setBounds(primaryDisplayBounds);
      mainWindow?.setFullScreen(true);
      mainWindow?.setAlwaysOnTop(true, 'screen-saver');
    }

    mainWindow?.focus();

    if (isDebug || isOverlayMode) {
      logWindowSafetyState();
    }

    if (isDebug && !mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

app.whenReady().then(() => {
  log(
    `Starting app. isPackaged=${app.isPackaged} isDev=${isDev} isDebug=${isDebug} isOverlayMode=${isOverlayMode}`
  );
  globalShortcut.register('CommandOrControl+Shift+U', emergencyUnlock);
  createWindow();
});

ipcMain.handle('preflight:unlock', () => {
  emergencyUnlock();
  return true;
});

ipcMain.handle('preflight:get-state', () => getChecklistState());

ipcMain.handle('preflight:set-completion', (_event, itemId: string, completed: boolean) =>
  setChecklistItemCompletion(itemId, completed)
);

ipcMain.handle('preflight:save-items', (_event, texts: string[]) => saveChecklistItems(texts));

ipcMain.handle('preflight:get-startup-enabled', () => {
  if (isDev) {
    return false;
  }

  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('preflight:set-startup-enabled', (_event, enabled: boolean) => {
  if (isDev) {
    log('Ignoring startup setting change in safe development mode');
    return false;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });

  return app.getLoginItemSettings().openAtLogin;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('render-process-gone', (_event, webContents, details) => {
  log(`Renderer process gone for ${webContents.getURL()}`, details);
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
