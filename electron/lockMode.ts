import type {
  BrowserWindow as BrowserWindowInstance,
  Display,
  GlobalShortcut,
  Screen
} from 'electron';
import { exec } from 'node:child_process';

const blockedShortcuts = [
  'Alt+Tab',
  'Alt+F4',
  'Super+D',
  'Super+L',
  'Super+M',
  'Super+Left',
  'Super+Right',
  'Super+Up',
  'Super+Down',
  'Super+Tab',
  'Ctrl+Escape',
  'Super+E',
  'Super+R',
  'Super+Tab'
];

export let explorerWasKilled = false;

/**
 * Registers no-op global shortcut handlers for common Windows task-switching
 * and shell shortcuts during lock mode.
 */
export function registerBlockedShortcuts(globalShortcut: GlobalShortcut) {
  for (const accelerator of blockedShortcuts) {
    globalShortcut.register(accelerator, () => {});
  }
}

/**
 * Unregisters all global shortcuts held by the app when leaving lock mode.
 */
export function unregisterBlockedShortcuts(globalShortcut: GlobalShortcut) {
  globalShortcut.unregisterAll();
}

/**
 * Refocuses and raises the lock window whenever focus leaves it, with a short
 * polling loop to recover from task switching and z-order changes.
 */
export function startFocusEnforcement(win: BrowserWindowInstance) {
  const focusWindow = () => {
    if (win.isDestroyed()) {
      return;
    }

    win.focus();
  };
  const handleBlur = () => {
    setTimeout(focusWindow, 50);
  };
  const interval = setInterval(() => {
    if (win.isDestroyed() || win.isFocused()) {
      return;
    }

    win.focus();
    win.moveTop();
  }, 200);

  win.on('blur', handleBlur);

  return () => {
    clearInterval(interval);

    if (!win.isDestroyed()) {
      win.removeListener('blur', handleBlur);
    }
  };
}

/**
 * Keeps the primary lock window pinned to the primary monitor's current bounds
 * if Windows moves or resizes it.
 */
export function enforcePrimaryMonitorBounds(win: BrowserWindowInstance, screen: Screen) {
  const enforceBounds = () => {
    if (win.isDestroyed()) {
      return;
    }

    const bounds = screen.getPrimaryDisplay().bounds;
    const currentBounds = win.getBounds();

    if (
      currentBounds.x === bounds.x &&
      currentBounds.y === bounds.y &&
      currentBounds.width === bounds.width &&
      currentBounds.height === bounds.height
    ) {
      return;
    }

    win.setPosition(bounds.x, bounds.y);
    win.setSize(bounds.width, bounds.height);
  };

  win.on('move', enforceBounds);
}

/**
 * Keeps a blocker window pinned to the explicit display bounds assigned when it
 * was created.
 */
export function enforceMonitorBounds(win: BrowserWindowInstance, display: Display) {
  const enforceBounds = () => {
    if (win.isDestroyed()) {
      return;
    }

    const { bounds } = display;
    const currentBounds = win.getBounds();

    if (
      currentBounds.x === bounds.x &&
      currentBounds.y === bounds.y &&
      currentBounds.width === bounds.width &&
      currentBounds.height === bounds.height
    ) {
      return;
    }

    win.setPosition(bounds.x, bounds.y);
    win.setSize(bounds.width, bounds.height);
  };

  win.on('move', enforceBounds);
}

/**
 * Terminates Windows Explorer to remove the taskbar and Start menu while the
 * checklist lock is active.
 */
export function killExplorer() {
  if (process.platform !== 'win32') {
    console.log('[PreFlight] Skipped killing Explorer on non-Windows platform');
    return;
  }

  exec('taskkill /f /im explorer.exe', (error, stdout, stderr) => {
    if (error) {
      console.error('[PreFlight] Failed to kill Explorer', { error, stderr });
      return;
    }

    explorerWasKilled = true;
    console.log('[PreFlight] Explorer killed', stdout);
  });
}

/**
 * Restarts Windows Explorer after lock mode ends or the app exits.
 */
export function restoreExplorer() {
  if (process.platform !== 'win32') {
    console.log('[PreFlight] Skipped restoring Explorer on non-Windows platform');
    return;
  }

  exec('start explorer.exe', (error, stdout, stderr) => {
    if (error) {
      console.error('[PreFlight] Failed to restore Explorer', { error, stderr });
      return;
    }

    explorerWasKilled = false;
    console.log('[PreFlight] Explorer restored', stdout);
  });
}
