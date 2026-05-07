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
  getBlockSecondaryScreensEnabled,
  getChecklistState,
  getStartOnStartupWakeEnabled,
  saveChecklistItems,
  setBlockSecondaryScreensEnabled,
  setStartOnStartupWakeEnabled,
  setChecklistItemCompletion
} from './store.js';
import {
  enforceMonitorBounds,
  enforcePrimaryMonitorBounds,
  explorerWasKilled,
  killExplorer,
  registerBlockedShortcuts,
  restoreExplorer,
  startFocusEnforcement,
  unregisterBlockedShortcuts
} from './lockMode.js';

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
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
const strictLockedMode = true;

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
let lockedSessionHasSeenIncomplete = false;
let displaySleepBlockerId: number | null = null;
let stopLockFocusEnforcement: (() => void) | null = null;
let rendererFailureActive = false;
let lockHardeningEngaged = false;

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
  if (strictLockedMode && locked) {
    log('Strict locked mode ignored emergency unlock request');
    reinforceLockedOverlay('ignored emergency unlock');
    return false;
  }

  log('Emergency unlock requested');
  unlockToTray('emergency unlock');
  return true;
}

function closeBlockerWindows() {
  for (const blocker of blockerWindows.values()) {
    if (!blocker.isDestroyed()) {
      blocker.destroy();
    }
  }

  blockerWindows.clear();
}

function reinforceLockedOverlay(reason: string) {
  if (!locked || appMode !== 'locked') {
    return;
  }

  log(`Reinforcing locked overlay: ${reason}`);
  syncOverlayWindows({ forceRepaint: true });
  mainWindow?.show();
  mainWindow?.setFullScreen(true);
  mainWindow?.setKiosk(true);
  mainWindow?.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow?.focus();
}

function isChecklistComplete(state = getChecklistState()) {
  return state.items.length > 0 && state.items.every((item) => item.completed);
}

function hasChecklistItems(state = getChecklistState()) {
  return state.items.length > 0;
}

function trackLockedChecklistState(state = getChecklistState()) {
  if (!locked || appMode !== 'locked') {
    return;
  }

  // Manual lock reopen can start with an already-complete checklist. Only
  // auto-unlock after this locked session has actually observed incomplete work.
  if (!isChecklistComplete(state)) {
    lockedSessionHasSeenIncomplete = true;
  }
}

function maybeAutoUnlockCompletedChecklist(reason: string, state = getChecklistState()) {
  if (!locked || appMode !== 'locked' || !lockedSessionHasSeenIncomplete || !isChecklistComplete(state)) {
    return false;
  }

  unlockToTray(reason);
  return true;
}

function acquireDisplaySleepBlocker(reason: string) {
  if (displaySleepBlockerId !== null && powerSaveBlocker.isStarted(displaySleepBlockerId)) {
    return;
  }

  // Electron exposes display sleep blocking at the app level. We hold it only
  // while the primary lock window is active, then release it on unlock/edit/quit.
  displaySleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  log('Display sleep blocker started', { id: displaySleepBlockerId, reason });
}

function releaseDisplaySleepBlocker(reason: string) {
  if (displaySleepBlockerId === null) {
    return;
  }

  const blockerId = displaySleepBlockerId;

  if (powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }

  displaySleepBlockerId = null;
  log('Display sleep blocker stopped', { id: blockerId, reason });
}

function registerEmergencyUnlockShortcut() {
  globalShortcut.register('CommandOrControl+Shift+U', emergencyUnlock);
}

function activateLockModeHardening(window: BrowserWindowInstance, reason: string) {
  lockHardeningEngaged = true;
  registerBlockedShortcuts(globalShortcut);

  stopLockFocusEnforcement?.();
  stopLockFocusEnforcement = startFocusEnforcement(window);
  enforcePrimaryMonitorBounds(window, screen);
  killExplorer();
  log(`Lock mode hardening activated: ${reason}`);
}

function engageLockModeWhenRendererLoads(
  window: BrowserWindowInstance,
  reason: string,
  options: OverlaySyncOptions = {}
) {
  let rendererLoaded = false;

  const loadTimeout = setTimeout(() => {
    if (rendererLoaded || window.isDestroyed() || appMode !== 'locked' || !locked) {
      return;
    }

    console.error('Renderer load timeout — triggering failure fallback');
    handleRendererFailure(window);
  }, 8000);

  window.webContents.once('did-finish-load', () => {
    rendererLoaded = true;
    clearTimeout(loadTimeout);

    if (rendererFailureActive || window.isDestroyed() || appMode !== 'locked' || !locked) {
      return;
    }

    console.log('Renderer loaded successfully, engaging lock mode');
    activateLockModeHardening(window, reason);
    syncOverlayWindows({ forceRepaint: options.forceRepaint ?? options.recreateBlockers });
    scheduleOverlayRefreshes(reason, options);
  });
}

function deactivateLockModeHardening(reason: string) {
  lockHardeningEngaged = false;
  stopLockFocusEnforcement?.();
  stopLockFocusEnforcement = null;
  unregisterBlockedShortcuts(globalShortcut);
  registerEmergencyUnlockShortcut();
  restoreExplorer();
  log(`Lock mode hardening deactivated: ${reason}`);
}

function restoreExplorerIfKilled(reason: string) {
  if (!explorerWasKilled) {
    return;
  }

  log(`Restoring Explorer: ${reason}`);
  restoreExplorer();
}

function rendererFailureHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            background: #1a0000;
            color: #ff4444;
            font-family: monospace;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
            padding: 32px;
            box-sizing: border-box;
          }
          h1 { font-size: 18px; margin-bottom: 12px; }
          p { color: rgba(255,255,255,0.6); font-size: 13px; margin: 6px 0; }
          button {
            margin-top: 24px;
            padding: 10px 24px;
            background: transparent;
            border: 1px solid #ff4444;
            color: #ff4444;
            font-family: monospace;
            font-size: 14px;
            cursor: pointer;
            letter-spacing: 0.1em;
          }
          button:hover { background: rgba(255,68,68,0.1); }
        </style>
      </head>
      <body>
        <h1>PreFlight could not load the renderer</h1>
        <p>The lock screen failed to start correctly.</p>
        <p>Your desktop has been unlocked automatically.</p>
        <button onclick="window.close()">CLOSE PREFLIGHT</button>
      </body>
      </html>
    `)}`;
}

function handleRendererFailure(window: BrowserWindowInstance) {
  if (rendererFailureActive || window.isDestroyed()) {
    return;
  }

  rendererFailureActive = true;

  restoreExplorer();
  appMode = 'edit';
  locked = false;
  lockHardeningEngaged = false;
  lockedSessionHasSeenIncomplete = false;
  openSettingsOnNextLoad = false;
  isQuitting = true;

  stopLockFocusEnforcement?.();
  stopLockFocusEnforcement = null;
  globalShortcut.unregisterAll();
  releaseDisplaySleepBlocker('renderer failure');
  closeBlockerWindows();

  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }

  window.setKiosk(false);
  window.setAlwaysOnTop(false);
  window.setSize(600, 400);
  window.center();
  window.show();
  window.focus();

  void window.webContents.loadURL(rendererFailureHtml()).catch((error) => {
    console.error('Failed to load renderer:', error);
  });
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
  releaseDisplaySleepBlocker('quit');
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
    void window.loadURL(process.env.VITE_DEV_SERVER_URL).catch((error) => {
      console.error('Failed to load renderer:', error);
    });
    return;
  }

  void window.loadFile(rendererTarget).catch((error) => {
    console.error('Failed to load renderer:', error);
  });
}

function clampWindowedContentHeight(height: number) {
  const workAreaHeight = screen.getPrimaryDisplay().workAreaSize.height;
  const maxHeight = Math.floor(workAreaHeight * 0.9);
  return Math.min(Math.max(Math.ceil(height), 600), maxHeight);
}

function getWindowedContentHeight() {
  const checklistItemCount = getChecklistState().items.length;
  const estimatedHeight = 120 + 30 + 120 + checklistItemCount * 70 + 80 + 40;
  return clampWindowedContentHeight(estimatedHeight);
}

function createWindow(mode: AppMode = appMode) {
  Menu.setApplicationMenu(null);
  const primaryDisplayBounds = screen.getPrimaryDisplay().bounds;
  const shouldLockWindow = mode === 'locked' && isOverlayMode;
  const windowedHeight = getWindowedContentHeight();

  const window = new BrowserWindow({
    x: shouldLockWindow ? primaryDisplayBounds.x : undefined,
    y: shouldLockWindow ? primaryDisplayBounds.y : undefined,
    width: shouldLockWindow ? primaryDisplayBounds.width : 1800,
    height: shouldLockWindow ? primaryDisplayBounds.height : windowedHeight,
    minWidth: 900,
    minHeight: 600,
    title: 'PreFlight',
    icon: getLogoImage(),
    fullscreen: shouldLockWindow,
    frame: !shouldLockWindow,
    kiosk: shouldLockWindow,
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
    window.setKiosk(true);
    window.setAlwaysOnTop(true, 'screen-saver', 1);
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
        if (!window.isDestroyed()) {
          window.focus();
        }
      }, 50);
    }
  });

  window.webContents.on('before-input-event', (event: ElectronEvent, input: Input) => {
    const key = input.key.toLowerCase();

    if (input.control && input.shift && key === 'u') {
      event.preventDefault();
      void emergencyUnlock();
      return;
    }

    if (locked && input.alt && key === 'f4') {
      event.preventDefault();
      mainWindow?.focus();
    }
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame) {
        debugLog(`Ignored non-main-frame load failure: ${validatedUrl}: ${errorCode} ${errorDescription}`);
        return;
      }

      console.error('Renderer failed to load:', errorCode, errorDescription);
      handleRendererFailure(window);
    }
  );

  window.webContents.on('did-finish-load', () => {
    debugLog(`Renderer finished loading: ${mainWindow?.webContents.getURL()}`);
    mainWindow?.setTitle('PreFlight');

    if (isOverlayMode || isDebug) {
      logRendererLayoutState();
      setTimeout(logRendererLayoutState, 500);
    }
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    if (isRecreatingMainWindow || isQuitting) {
      return;
    }

    console.error('Renderer process gone:', details.reason);
    handleRendererFailure(window);
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
      window.setKiosk(true);
      window.setAlwaysOnTop(true, 'screen-saver', 1);
    }

    window.focus();

    if (isDebug || shouldLockWindow) {
      logWindowSafetyState();
    }

    if (isDebug && !window.webContents.isDevToolsOpened()) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });

  return window;
}

function recreateMainWindow(mode: AppMode) {
  isRecreatingMainWindow = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close');
    mainWindow.destroy();
  }

  mainWindow = null;
  const window = createWindow(mode);
  isRecreatingMainWindow = false;
  return window;
}

function enterEditMode(reason: string, openSettings = true) {
  appMode = 'edit';
  locked = false;
  openSettingsOnNextLoad = openSettings;
  lockedSessionHasSeenIncomplete = false;
  releaseDisplaySleepBlocker(`enter edit mode: ${reason}`);
  deactivateLockModeHardening(`enter edit mode: ${reason}`);
  closeBlockerWindows();
  log(`Entering edit mode: ${reason}`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }

    mainWindow.setKiosk(false);
    mainWindow.setAlwaysOnTop(false);
  }

  recreateMainWindow('edit');
}

function unlockToTray(reason: string) {
  log(`Unlocking to tray: ${reason}`);
  appMode = 'edit';
  locked = false;
  openSettingsOnNextLoad = false;
  lockedSessionHasSeenIncomplete = false;
  releaseDisplaySleepBlocker(`unlock to tray: ${reason}`);
  deactivateLockModeHardening(`unlock to tray: ${reason}`);
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
  lockHardeningEngaged = false;
  openSettingsOnNextLoad = false;
  lockedSessionHasSeenIncomplete = locked && !isChecklistComplete();
  log(`Entering ${appMode} mode: ${reason}`);

  if (!isOverlayMode) {
    deactivateLockModeHardening(`locked mode unavailable: ${reason}`);
    lockedSessionHasSeenIncomplete = false;
    releaseDisplaySleepBlocker(`locked mode unavailable: ${reason}`);
    closeBlockerWindows();
    recreateMainWindow('edit');
    return;
  }

  acquireDisplaySleepBlocker(`enter locked mode: ${reason}`);

  if (options.recreateBlockers) {
    closeBlockerWindows();
  }

  const window = recreateMainWindow('locked');
  engageLockModeWhenRendererLoads(window, `enter locked mode: ${reason}`, options);
}

function configureInitialMode() {
  const shouldLockOnStart = getStartOnStartupWakeEnabled();

  if (shouldLockOnStart) {
    appMode = isOverlayMode ? 'locked' : 'edit';
    locked = appMode === 'locked' && isOverlayMode;
    openSettingsOnNextLoad = false;
    lockedSessionHasSeenIncomplete = locked && !isChecklistComplete();
    log(`Startup/wake lock is enabled; initial mode is ${appMode}`);
    return;
  }

  appMode = 'edit';
  locked = false;
  openSettingsOnNextLoad = !hasChecklistItems();
  lockedSessionHasSeenIncomplete = false;
  log('Startup/wake lock is disabled; initial mode is tray');
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
    focusable: true,
    kiosk: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  blocker.setAlwaysOnTop(true, 'screen-saver', 1);
  enforceMonitorBounds(blocker, display);

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

  blocker.on('blur', () => {
    setTimeout(() => {
      if (!blocker.isDestroyed()) {
        blocker.focus();
      }
    }, 50);
  });

  blocker.webContents.on('before-input-event', (event: ElectronEvent, input: Input) => {
    const key = input.key.toLowerCase();

    if (input.control && input.shift && key === 'u') {
      event.preventDefault();
      void emergencyUnlock();
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

  void blocker.loadURL(blockerHtml()).catch((error) => {
    console.error('Failed to load renderer:', error);
  });
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
  blocker.setKiosk(true);
  blocker.setBounds(display.bounds);
  blocker.setAlwaysOnTop(true, 'screen-saver', 1);
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
  if (!isOverlayMode || appMode !== 'locked' || !locked || !lockHardeningEngaged) {
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  const activeDisplayIds = new Set(displays.map((display) => display.id));

  mainWindow?.setBounds(primaryDisplay.bounds);
  mainWindow?.setFullScreen(true);
  mainWindow?.setAlwaysOnTop(true, 'screen-saver', 1);

  if (!getBlockSecondaryScreensEnabled()) {
    closeBlockerWindows();
    mainWindow?.focus();
    return;
  }

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
    syncOverlayWindows({ forceRepaint: true });
    scheduleOverlayRefreshes('display added', { forceRepaint: true });
  });

  screen.on('display-removed', () => {
    log('Display removed');
    syncOverlayWindows();
  });

  screen.on('display-metrics-changed', () => {
    log('Display metrics changed');
    syncOverlayWindows({ forceRepaint: true });
    scheduleOverlayRefreshes('display metrics changed', { forceRepaint: true });
  });
}

app.whenReady().then(() => {
  configureInitialMode();
  applyLoginItemSetting(getStartOnStartupWakeEnabled());
  log(
    `Starting app. isPackaged=${app.isPackaged} isDev=${isDev} isDebug=${isDebug} isOverlayMode=${isOverlayMode} appMode=${appMode}`
  );
  registerEmergencyUnlockShortcut();

  if (locked) {
    acquireDisplaySleepBlocker('startup locked mode');
  }

  registerDisplayHandlers();
  createTray();

  if (locked) {
    const startupWindow = createWindow(appMode);
    engageLockModeWhenRendererLoads(startupWindow, 'startup locked mode', { forceRepaint: true });
  } else if (!hasChecklistItems()) {
    log('Checklist is empty; opening settings on first launch');
    createWindow('edit');
  }

  powerMonitor.on('resume', () => {
    if (getStartOnStartupWakeEnabled()) {
      enterLockedMode('power resume', { forceRepaint: true, recreateBlockers: true });
      return;
    }

    log('Power resume detected; startup/wake lock is disabled');
  });

  // Startup lock hardening is engaged only after the renderer confirms it loaded.
});

ipcMain.handle('preflight:unlock', () => {
  if (strictLockedMode) {
    // Strict mode ignores escape hatches, but the visible Unlock control should
    // always work once the persisted checklist state is complete.
    if (locked && appMode === 'locked' && isChecklistComplete()) {
      unlockToTray('completed checklist unlock');
      return true;
    }

    log('Strict locked mode ignored renderer unlock request');
    reinforceLockedOverlay('ignored renderer unlock');
    return false;
  }

  return emergencyUnlock();
});

ipcMain.handle('preflight:get-mode', () => ({
  mode: appMode,
  locked,
  strict: strictLockedMode,
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
    strict: strictLockedMode,
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
    strict: strictLockedMode,
    debug: isDebug,
    overlay: isOverlayMode,
    openSettings: false
  };
});

ipcMain.handle('preflight:get-state', () => {
  return getChecklistState();
});

ipcMain.handle('preflight:set-completion', (_event, itemId: string, completed: boolean) => {
  const state = setChecklistItemCompletion(itemId, completed);
  trackLockedChecklistState(state);
  maybeAutoUnlockCompletedChecklist('all checklist items completed', state);
  return state;
});

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

ipcMain.handle('get-block-secondary-screens', () => {
  return getBlockSecondaryScreensEnabled();
});

ipcMain.handle('set-block-secondary-screens', (_event, enabled: boolean) => {
  const saved = setBlockSecondaryScreensEnabled(Boolean(enabled));

  if (locked && appMode === 'locked') {
    if (saved) {
      syncOverlayWindows({ forceRepaint: true });
    } else {
      closeBlockerWindows();
    }
  }

  return saved;
});

ipcMain.on('resize-to-content', (event, payload: { height?: number }) => {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (
    !window ||
    window !== mainWindow ||
    appMode === 'locked' ||
    locked ||
    window.isDestroyed() ||
    window.isFullScreen()
  ) {
    return;
  }

  const requestedHeight = Number(payload?.height);

  if (!Number.isFinite(requestedHeight)) {
    return;
  }

  const [currentWidth] = window.getSize();
  window.setSize(currentWidth, clampWindowedContentHeight(requestedHeight));
});

app.on('will-quit', () => {
  stopLockFocusEnforcement?.();
  stopLockFocusEnforcement = null;
  unregisterBlockedShortcuts(globalShortcut);
  restoreExplorerIfKilled('will quit');
  releaseDisplaySleepBlocker('will quit');
  closeBlockerWindows();
  tray?.destroy();
  tray = null;
});

app.on('before-quit', () => {
  restoreExplorerIfKilled('before quit');
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
    const window = createWindow(appMode);

    if (locked) {
      engageLockModeWhenRendererLoads(window, 'activate', { forceRepaint: true });
    }
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

process.on('exit', () => {
  restoreExplorerIfKilled('process exit');
});

process.on('SIGTERM', () => {
  restoreExplorerIfKilled('SIGTERM');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  restoreExplorerIfKilled('uncaught exception');
  throw error;
});
