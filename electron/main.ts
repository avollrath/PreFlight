import type {
  BrowserWindow as BrowserWindowInstance,
  Display,
  Event as ElectronEvent,
  Input,
  Settings as LoginItemSettingsOptions,
  Tray as TrayInstance
} from 'electron';
import path from 'node:path';
import {
  getChecklistState,
  getStartOnStartupWakeEnabled,
  saveChecklistItems,
  setStartOnStartupWakeEnabled,
  setChecklistItemCompletion
} from './store.js';

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray
} = require('electron') as typeof import('electron');

const isDev =
  process.env.PREFLIGHT_DEV_SAFE === '1' ||
  process.env.PREFLIGHT_DEV_LOCKED === '1' ||
  Boolean(process.env.VITE_DEV_SERVER_URL) ||
  !app.isPackaged;
const isDebug = process.env.PREFLIGHT_DEV_DEBUG === '1';
const isOverlayMode = !isDebug && (!isDev || process.env.PREFLIGHT_DEV_LOCKED === '1');

let mainWindow: BrowserWindowInstance | null = null;
let tray: TrayInstance | null = null;
const blockerWindows = new Map<number, BrowserWindowInstance>();
type AppMode = 'locked' | 'edit';
type OverlaySyncOptions = {
  forceRepaint?: boolean;
  recreateBlockers?: boolean;
};

let appMode: AppMode = 'edit';
let locked = false;
let isRecreatingMainWindow = false;
let isQuitting = false;
let openSettingsOnNextLoad = true;

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

function blockerHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>PreFlight Blocker</title>
        <style>
          html,
          body {
            width: 100%;
            height: 100%;
            margin: 0;
            overflow: hidden;
            background:
              repeating-linear-gradient(0deg, rgba(255, 23, 68, 0.035) 0 1px, transparent 1px 4px),
              linear-gradient(rgba(255, 23, 68, 0.055) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 23, 68, 0.045) 1px, transparent 1px),
              radial-gradient(circle at 50% 0%, rgba(255, 23, 68, 0.15), transparent 38%),
              linear-gradient(135deg, #050104 0%, #140309 45%, #000 100%);
            background-size: auto, 42px 42px, 42px 42px, auto, auto;
          }

          body::before {
            content: "";
            position: fixed;
            inset: 0;
            border: 1px solid rgba(255, 23, 68, 0.38);
            background:
              radial-gradient(circle at 50% 50%, transparent 0%, rgba(0, 0, 0, 0.18) 58%, rgba(0, 0, 0, 0.5) 100%);
            box-shadow:
              0 0 0 1px rgba(255, 23, 68, 0.08) inset,
              0 0 44px rgba(255, 23, 68, 0.16) inset;
            pointer-events: none;
          }
        </style>
      </head>
      <body></body>
    </html>
  `)}`;
}

function emergencyUnlock() {
  log('Emergency unlock requested');
  unlockToTray('emergency unlock');
}

function closeBlockerWindows() {
  for (const blocker of blockerWindows.values()) {
    if (!blocker.isDestroyed()) {
      blocker.destroy();
    }
  }

  blockerWindows.clear();
}

function getLogoPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'logo.png');
  }

  return path.join(app.getAppPath(), 'src', 'assets', 'logo.png');
}

function getLogoImage() {
  const logoPath = getLogoPath();
  const image = nativeImage.createFromPath(logoPath);

  if (image.isEmpty()) {
    log('Logo image could not be loaded', { logoPath });
  }

  return image;
}

function quitPreFlight() {
  isQuitting = true;
  locked = false;
  closeBlockerWindows();
  app.quit();
}

function createTray() {
  if (tray) {
    return;
  }

  // nativeImage keeps the tray icon portable across Windows, macOS, and Linux.
  tray = new Tray(getLogoImage());
  tray.setToolTip('PreFlight');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Edit Mode',
        click: () => enterEditMode('tray menu')
      },
      {
        label: 'Lock Now',
        click: () => enterLockedMode('tray menu')
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: quitPreFlight
      }
    ])
  );
}

function applyLoginItemSetting(enabled: boolean) {
  const loginItemOptions: LoginItemSettingsOptions = {
    openAtLogin: enabled
  };

  if (process.platform === 'win32') {
    loginItemOptions.path = process.execPath;

    if (isDev) {
      loginItemOptions.args = [app.getAppPath()];

      if (enabled) {
        log('Development startup registration requested. Windows may launch Electron without the Vite dev server.');
      }
    }
  }

  try {
    app.setLoginItemSettings(loginItemOptions);
  } catch (error) {
    log('Unable to update login item settings', error);
  }
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
    appMode,
    locked
  });

  log(
    'Display coverage state',
    screen.getAllDisplays().map((display) => ({
      id: display.id,
      primary: display.id === screen.getPrimaryDisplay().id,
      bounds: display.bounds,
      hasBlocker: blockerWindows.has(display.id)
    }))
  );
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
          height: document.querySelector('.preflight-panel')?.getBoundingClientRect().height,
          scrollWidth: document.querySelector('.preflight-panel')?.scrollWidth,
          clientWidth: document.querySelector('.preflight-panel')?.clientWidth,
          scrollHeight: document.querySelector('.preflight-panel')?.scrollHeight,
          clientHeight: document.querySelector('.preflight-panel')?.clientHeight
        },
        dashboardContent: {
          width: document.querySelector('.dashboard-content')?.getBoundingClientRect().width,
          height: document.querySelector('.dashboard-content')?.getBoundingClientRect().height,
          scrollWidth: document.querySelector('.dashboard-content')?.scrollWidth,
          clientWidth: document.querySelector('.dashboard-content')?.clientWidth,
          scrollHeight: document.querySelector('.dashboard-content')?.scrollHeight,
          clientHeight: document.querySelector('.dashboard-content')?.clientHeight
        },
        settingsOpen: Boolean(document.querySelector('.settings-view'))
      })`
    )
    .then((layout) => log('Renderer layout state', layout))
    .catch((error) => log('Renderer layout state unavailable', error));
}

function loadRenderer(window: BrowserWindowInstance) {
  const rendererTarget = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : path.join(__dirname, '../dist/index.html');

  log(
    process.env.VITE_DEV_SERVER_URL
      ? `Loading renderer URL: ${rendererTarget}`
      : `Loading renderer file: ${rendererTarget}`
  );

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }

  void window.loadFile(rendererTarget);
}

function createWindow(mode: AppMode = appMode) {
  Menu.setApplicationMenu(null);
  const primaryDisplayBounds = screen.getPrimaryDisplay().bounds;
  const shouldLockWindow = mode === 'locked' && isOverlayMode;

  const window = new BrowserWindow({
    x: shouldLockWindow ? primaryDisplayBounds.x : undefined,
    y: shouldLockWindow ? primaryDisplayBounds.y : undefined,
    width: shouldLockWindow ? primaryDisplayBounds.width : 1800,
    height: shouldLockWindow ? primaryDisplayBounds.height : 1000,
    minWidth: 900,
    minHeight: 620,
    title: 'PreFlight',
    icon: getLogoImage(),
    fullscreen: shouldLockWindow,
    frame: !shouldLockWindow,
    resizable: !shouldLockWindow,
    alwaysOnTop: shouldLockWindow,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    show: !shouldLockWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = window;

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (shouldLockWindow) {
    window.setBounds(primaryDisplayBounds);
    window.setAlwaysOnTop(true, 'screen-saver');
  }

  window.on('close', (event: ElectronEvent) => {
    if (isRecreatingMainWindow || isQuitting) {
      return;
    }

    event.preventDefault();

    if (locked) {
      window.show();
      window.focus();
      return;
    }

    window.hide();
    log('Main window hidden to tray');
  });

  window.on('blur', () => {
    if (locked) {
      setTimeout(() => {
        mainWindow?.show();
        mainWindow?.focus();
      }, 100);
    }
  });

  window.webContents.on('before-input-event', (event: ElectronEvent, input: Input) => {
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

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    const message = `Failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`;
    log(message);
    void mainWindow?.loadURL(fallbackHtml(message));
  });

  window.webContents.on('did-finish-load', () => {
    debugLog(`Renderer finished loading: ${mainWindow?.webContents.getURL()}`);
    mainWindow?.setTitle('PreFlight');

    if (isOverlayMode || isDebug) {
      logRendererLayoutState();
      setTimeout(logRendererLayoutState, 500);
    }
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    log('Renderer process exited', details);
  });

  window.webContents.on('crashed', () => {
    log('Renderer process crashed');
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    debugLog(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
  });

  loadRenderer(window);

  if (!shouldLockWindow) {
    window.show();
    window.focus();

    if (isDebug) {
      window.webContents.openDevTools({ mode: 'detach' });
      logWindowSafetyState();
    }
  }

  window.once('ready-to-show', () => {
    window.show();

    if (shouldLockWindow) {
      window.setBounds(primaryDisplayBounds);
      window.setFullScreen(true);
      window.setAlwaysOnTop(true, 'screen-saver');
      syncOverlayWindows();
    }

    window.focus();

    if (isDebug || shouldLockWindow) {
      logWindowSafetyState();
    }

    if (isDebug && !window.webContents.isDevToolsOpened()) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

function recreateMainWindow(mode: AppMode) {
  isRecreatingMainWindow = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close');
    mainWindow.destroy();
  }

  mainWindow = null;
  createWindow(mode);
  isRecreatingMainWindow = false;
}

function enterEditMode(reason: string, openSettings = true) {
  appMode = 'edit';
  locked = false;
  openSettingsOnNextLoad = openSettings;
  closeBlockerWindows();
  log(`Entering edit mode: ${reason}`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }

    mainWindow.setAlwaysOnTop(false);
  }

  recreateMainWindow('edit');
}

function unlockToTray(reason: string) {
  log(`Unlocking to tray: ${reason}`);
  appMode = 'edit';
  locked = false;
  openSettingsOnNextLoad = false;
  closeBlockerWindows();

  if (mainWindow && !mainWindow.isDestroyed()) {
    const window = mainWindow;
    mainWindow = null;
    window.hide();
    window.destroy();
  }
}

function enterLockedMode(reason: string, options: OverlaySyncOptions = {}) {
  appMode = isOverlayMode ? 'locked' : 'edit';
  locked = appMode === 'locked' && isOverlayMode;
  openSettingsOnNextLoad = false;
  log(`Entering ${appMode} mode: ${reason}`);

  if (!isOverlayMode) {
    closeBlockerWindows();
    recreateMainWindow('edit');
    return;
  }

  if (options.recreateBlockers) {
    closeBlockerWindows();
  }

  recreateMainWindow('locked');
  scheduleOverlayRefreshes(reason, options);
}

function configureInitialMode() {
  const shouldLockOnStart = getStartOnStartupWakeEnabled();

  if (shouldLockOnStart) {
    appMode = isOverlayMode ? 'locked' : 'edit';
    locked = appMode === 'locked' && isOverlayMode;
    openSettingsOnNextLoad = false;
    log(`Startup/wake lock is enabled; initial mode is ${appMode}`);
    return;
  }

  appMode = 'edit';
  locked = false;
  openSettingsOnNextLoad = true;
  log('Startup/wake lock is disabled; initial mode is edit');
}

function createBlockerWindow(display: Display) {
  const existingBlocker = blockerWindows.get(display.id);

  if (existingBlocker && !existingBlocker.isDestroyed()) {
    forceBlockerVisible(existingBlocker, display);
    return existingBlocker;
  }

  blockerWindows.delete(display.id);

  const blocker = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    title: 'PreFlight Blocker',
    fullscreen: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    backgroundColor: '#050104',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Position before loading so the first paint happens on the intended monitor.
  forceBlockerVisible(blocker, display, { shouldShow: false });

  blocker.on('closed', () => {
    if (blockerWindows.get(display.id) === blocker) {
      blockerWindows.delete(display.id);
    }
  });

  blocker.on('close', (event: ElectronEvent) => {
    if (locked && !isQuitting) {
      event.preventDefault();
      blocker.show();
      blocker.focus();
    }
  });

  blocker.webContents.on('before-input-event', (event: ElectronEvent, input: Input) => {
    const key = input.key.toLowerCase();

    if (input.control && input.shift && key === 'u') {
      event.preventDefault();
      emergencyUnlock();
      return;
    }

    if (locked && input.alt && key === 'f4') {
      event.preventDefault();
      blocker.focus();
    }
  });

  blocker.webContents.on('did-finish-load', () => {
    forceBlockerVisible(blocker, display);
  });

  blocker.once('ready-to-show', () => {
    forceBlockerVisible(blocker, display);
  });

  void blocker.loadURL(blockerHtml());
  blockerWindows.set(display.id, blocker);
  log('Created secondary display blocker', { id: display.id, bounds: display.bounds });
  return blocker;
}

function forceBlockerVisible(
  blocker: BrowserWindowInstance,
  display: Display,
  options: { forceRepaint?: boolean; shouldShow?: boolean } = {}
) {
  if (blocker.isDestroyed()) {
    return;
  }

  const shouldShow = options.shouldShow ?? true;

  // Sleep/resume can leave secondary windows in the compositor but not visibly painted.
  // Reapplying geometry, topmost state, visibility, and explicit invalidation asks
  // Windows to redraw the static blocker immediately on the target display. During
  // resume-specific refreshes we briefly hide/show the window as a stronger compositor
  // nudge without reloading the blocker HTML.
  if (options.forceRepaint && blocker.isVisible()) {
    blocker.hide();
  }

  blocker.setBounds(display.bounds);
  blocker.setFullScreen(true);
  blocker.setBounds(display.bounds);
  blocker.setAlwaysOnTop(true, 'screen-saver');
  blocker.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (shouldShow) {
    blocker.showInactive();
    blocker.moveTop();
    blocker.webContents.invalidate();

    if (options.forceRepaint) {
      setTimeout(() => {
        if (blocker.isDestroyed()) {
          return;
        }

        blocker.showInactive();
        blocker.moveTop();
        blocker.webContents.invalidate();
      }, 50);
    }
  }
}

function syncOverlayWindows(options: OverlaySyncOptions = {}) {
  if (!isOverlayMode || appMode !== 'locked' || !locked) {
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  const activeDisplayIds = new Set(displays.map((display) => display.id));

  mainWindow?.setBounds(primaryDisplay.bounds);
  mainWindow?.setFullScreen(true);
  mainWindow?.setAlwaysOnTop(true, 'screen-saver');

  if (options.recreateBlockers) {
    closeBlockerWindows();
  }

  for (const [displayId, blocker] of blockerWindows.entries()) {
    if (!activeDisplayIds.has(displayId) || displayId === primaryDisplay.id) {
      blocker.destroy();
      blockerWindows.delete(displayId);
    }
  }

  for (const display of displays) {
    if (display.id === primaryDisplay.id) {
      continue;
    }

    const blocker = blockerWindows.get(display.id);

    if (blocker) {
      forceBlockerVisible(blocker, display, { forceRepaint: options.forceRepaint });
      continue;
    }

    createBlockerWindow(display);
  }

  mainWindow?.focus();
}

function scheduleOverlayRefreshes(reason: string, options: OverlaySyncOptions = {}) {
  for (const delay of [0, 100, 500, 1250, 2500, 5000]) {
    setTimeout(() => {
      if (!locked || appMode !== 'locked') {
        return;
      }

      log(`Refreshing locked overlay windows after ${reason}`, { delay });
      syncOverlayWindows({ forceRepaint: options.forceRepaint ?? options.recreateBlockers });
    }, delay);
  }
}

function registerDisplayHandlers() {
  screen.on('display-added', () => {
    log('Display added');
    syncOverlayWindows();
  });

  screen.on('display-removed', () => {
    log('Display removed');
    syncOverlayWindows();
  });

  screen.on('display-metrics-changed', () => {
    log('Display metrics changed');
    syncOverlayWindows();
  });
}

app.whenReady().then(() => {
  configureInitialMode();
  applyLoginItemSetting(getStartOnStartupWakeEnabled());
  log(
    `Starting app. isPackaged=${app.isPackaged} isDev=${isDev} isDebug=${isDebug} isOverlayMode=${isOverlayMode} appMode=${appMode}`
  );
  globalShortcut.register('CommandOrControl+Shift+U', emergencyUnlock);
  registerDisplayHandlers();
  createTray();
  createWindow(appMode);

  powerMonitor.on('resume', () => {
    if (getStartOnStartupWakeEnabled()) {
      enterLockedMode('power resume', { forceRepaint: true, recreateBlockers: true });
      return;
    }

    log('Power resume detected; startup/wake lock is disabled');
  });

  if (isOverlayMode && appMode === 'locked') {
    scheduleOverlayRefreshes('startup');
  }
});

ipcMain.handle('preflight:unlock', () => {
  emergencyUnlock();
  return true;
});

ipcMain.handle('preflight:get-mode', () => ({
  mode: appMode,
  locked,
  debug: isDebug,
  overlay: isOverlayMode,
  openSettings: consumeOpenSettingsOnNextLoad()
}));

function consumeOpenSettingsOnNextLoad() {
  const shouldOpenSettings = openSettingsOnNextLoad;
  openSettingsOnNextLoad = false;
  return shouldOpenSettings;
}

ipcMain.handle('preflight:enter-edit-mode', () => {
  enterEditMode('renderer request');
  return {
    mode: appMode,
    locked,
    debug: isDebug,
    overlay: isOverlayMode,
    openSettings: true
  };
});

ipcMain.handle('preflight:lock-now', () => {
  enterLockedMode('renderer request');
  return {
    mode: appMode,
    locked,
    debug: isDebug,
    overlay: isOverlayMode,
    openSettings: false
  };
});

ipcMain.handle('preflight:get-state', () => getChecklistState());

ipcMain.handle('preflight:set-completion', (_event, itemId: string, completed: boolean) =>
  setChecklistItemCompletion(itemId, completed)
);

ipcMain.handle('preflight:save-items', (_event, texts: string[]) => saveChecklistItems(texts));

ipcMain.handle('preflight:get-startup-enabled', () => {
  return getStartOnStartupWakeEnabled();
});

ipcMain.handle('preflight:set-startup-enabled', (_event, enabled: boolean) => {
  if (isDev) {
    log('Startup/wake setting changed in development mode for testing');
  }

  const saved = setStartOnStartupWakeEnabled(enabled);
  applyLoginItemSetting(saved);
  return saved;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  closeBlockerWindows();
  tray?.destroy();
  tray = null;
});

app.on('render-process-gone', (_event, webContents, details) => {
  log(`Renderer process gone for ${webContents.getURL()}`, details);
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(appMode);
  }
});

app.on('window-all-closed', () => {
  if (isRecreatingMainWindow || !isQuitting) {
    return;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
