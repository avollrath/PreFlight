# PreFlight

PreFlight is a Windows-first Electron productivity gate. It starts in a windowed setup mode for editing your checklist, then can switch into a fullscreen checklist overlay when you choose **Lock now** or when startup/wake locking is enabled.

Strict locked mode disables **Dev Unlock** and `Ctrl+Shift+U` while locked. The lock closes only when every checklist item is complete.

## Features

- Windowed edit mode on startup with settings open unless startup/wake locking is enabled
- Fullscreen, frameless, always-on-top checklist overlay on demand, startup, or resume
- Secondary monitor blocker overlays while locked (covers all secondary displays)
- Dark 80s-inspired neon dashboard theme with Electrolize font and animated scan bar
- Daily checklist completion state stored locally
- Editable checklist items in the full-window settings panel
- Windowed setup mode for editing without monitor blockers
- System tray controls for edit mode, lock now, and quit
- Automatic unlock when every checklist item is complete
- Strict locked mode disables Dev Unlock button and `Ctrl+Shift+U` emergency unlock
- Focus reinforcement and kiosk-style window behavior while locked
- Display sleep prevention during locked mode
- Disabled `Alt+Tab` and `Win+Arrow` shortcuts while locked (best-effort)
- Windows login startup toggle with automatic lock on startup and resume
- Current-user Windows Task Scheduler helper for workstation unlock
- Windows packaging through electron-builder
- Debug mode with DevTools and verbose diagnostics

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

`npm run dev` starts in edit mode with Settings open. Closing the main window with the `X` hides it to the system tray instead of quitting. Use **Lock now** from the app or tray when you want the real overlay: fullscreen on the primary monitor, secondary monitor blocker windows, always-on-top behavior, and blocked `Alt+F4` while locked.

Strict locked mode intentionally disables development escape routes while locked:

- Clicking **Dev Unlock Disabled** has no effect
- Pressing `Ctrl+Shift+U` has no effect

Completing every checklist item closes the primary overlay, closes secondary blockers, and leaves PreFlight running in the tray. Use the tray menu's **Open Edit Mode** item to reopen setup mode.

While locked, PreFlight uses kiosk windows, always-on-top overlays, focus reinforcement, and best-effort Electron shortcut registration for common task-switching shortcuts such as `Alt+Tab` and `Win+Arrow`. Some Windows-reserved keys may require OS kiosk policy to block completely; PreFlight intentionally avoids invasive low-level keyboard hooks.

Use **Setup mode** or **Settings** to edit checklist items. Saving checklist changes stays in setup mode. Use **Lock now** when you want to return to the fullscreen overlay and secondary monitor blockers. Setup mode is not persisted; a fresh app launch starts in edit mode with Settings open unless **Start PreFlight when Windows starts/wakes up** is enabled.

PreFlight also adds a system tray icon using the app logo. Its tooltip is **PreFlight**, and its menu includes **Open Edit Mode**, **Lock Now**, and **Quit**.

Use debug mode when you want a safer troubleshooting window with DevTools and verbose renderer diagnostics:

```bash
npm run dev:debug
```

`npm run dev:debug` uses a normal primary-monitor window instead of the locked fullscreen multi-monitor overlay. It does not create secondary blocker windows, which makes it the safer troubleshooting mode.

`npm run dev:safe` is kept as an alias for debug mode:

```bash
npm run dev:safe
```

The UI uses an 80s neon dashboard style with the Electrolize font, red system-status controls, terminal-like panels, and a lightweight animated scan bar.

## Build And Run

```bash
npm run build
npm run start
```

## Package For Windows

Create an unpacked executable:

```bash
npm run package
```

The executable is written to:

```text
release/win-unpacked/PreFlight.exe
```

Create the installer target:

```bash
npm run dist
```

Build output is ignored by git.

## Local Data

PreFlight stores local configuration in Electron's `userData` folder as `preflight-store.json`.

The checklist definitions are stored locally. Completion state is keyed by local date, so the checklist automatically starts fresh when the date changes.

To reset local app data on Windows, close PreFlight and remove:

```powershell
Remove-Item "$env:APPDATA\PreFlight" -Recurse -Force
```

## Diagnostics

If PreFlight opens black in development, press `Ctrl+Shift+U` first. It should leave the locked overlay and open setup mode even if the renderer is broken.

Launch debug mode:

```bash
npm run dev:debug
```

Launch the debug alias:

```bash
npm run dev:safe
```

Logs are printed in the terminal running the dev command. Normal dev logs the app startup and renderer target. Debug mode also logs renderer console messages, renderer load completion, and the development window safety state.

If you need to kill the app from PowerShell:

```powershell
Get-Process electron,PreFlight -ErrorAction SilentlyContinue | Stop-Process -Force
```

If the app behaves strangely after editing settings, reset local data with the `Remove-Item "$env:APPDATA\PreFlight" -Recurse -Force` command above.

## Windows Startup

Open **Settings** in PreFlight and enable **Start PreFlight when Windows starts/wakes up**.

The toggle is stored in PreFlight's local JSON data and uses Electron's login item support for the current OS user. When enabled, PreFlight starts in locked fullscreen mode on app launch and re-enters locked mode after `powerMonitor.resume`. Development mode no longer ignores this setting, although Windows login startup is most reliable from a packaged `PreFlight.exe`.

## Workstation Unlock Task

Package the app first:

```bash
npm run package
```

Install the current-user unlock task from PowerShell:

```powershell
.\scripts\windows\install-wakeup-task.ps1
```

If the executable is somewhere else, pass it explicitly:

```powershell
.\scripts\windows\install-wakeup-task.ps1 -AppPath "C:\Path\To\PreFlight.exe"
```

Remove the task:

```powershell
.\scripts\windows\uninstall-wakeup-task.ps1
```

The MVP uses the reliable workstation unlock trigger. Wake-from-sleep event timing varies across Windows hardware and power states, so unlock is the fallback trigger for this version.

## Safety Notes

PreFlight does not install low-level keyboard hooks, block `Ctrl+Alt+Del`, replace Explorer, or use a separate Windows user. It is a normal desktop app with development escape hatches.

## Lock Hardening

PreFlight hardens locked mode with Electron user-space controls plus Windows shell suppression. While locked, it registers no-op handlers for `Alt+Tab`, `Alt+F4`, `Win+D`, `Win+L`, `Win+M`, `Win+Left`, `Win+Right`, `Win+Up`, `Win+Down`, `Win+Tab`, `Ctrl+Escape`, `Win+E`, and `Win+R`. These registrations are best-effort: Windows reserves some combinations before Electron can receive them, especially `Ctrl+Alt+Del`, the Windows key by itself, and workstation lock behavior such as `Win+L`.

On Windows, PreFlight kills `explorer.exe` during locked mode to remove the taskbar, Start menu, desktop shell, and shell launch surfaces. Explorer is restored when the checklist unlocks, when lock mode exits, and from app exit handlers such as `before-quit`, `will-quit`, `SIGTERM`, process exit, and uncaught exception handling. Explorer control is skipped on non-Windows platforms.

The primary lock window uses blur recapture after 50ms and a 200ms focus enforcement interval. The interval calls `focus()` and `moveTop()` when the primary lock window loses focus, which helps recover from task switching, z-order changes, and compositor edge cases that are not covered by a single blur event.

Monitor bounds are clamped while locked. The primary lock window is reset to the primary display bounds if moved or resized, and every secondary blocker window is reset to its assigned display bounds. This counters window snapping and `Win+Arrow` movement when Electron or Windows allows a move event through.

| Surface | Electron User-Space Status | Notes |
| --- | --- | --- |
| `Alt+F4` | Blockable | Handled with global shortcuts and renderer input interception. |
| `Alt+Tab` | Best-effort | Electron can register it on some systems, but Windows may reserve it. |
| `Win+Arrow` | Best-effort plus clamped | Shortcut registration is best-effort; move events are corrected by bounds clamping. |
| `Win+D`, `Win+M`, `Win+Tab`, `Ctrl+Escape`, `Win+E`, `Win+R` | Best-effort | Registered while locked and paired with Explorer shutdown where applicable. |
| Taskbar and Start menu | Suppressed on Windows | `explorer.exe` is killed during lock and restored afterward. |
| `Ctrl+Alt+Del` | Not blockable | Secure attention sequence is reserved by Windows. |
| Windows key alone | Not reliably blockable | Reserved shell behavior; user-space Electron apps should not depend on intercepting it. |
| `Win+L` | Not reliably blockable | Workstation locking is OS-reserved on many Windows configurations. |
| Power button, firmware keys, external admin tools | Not blockable | Requires OS policy, kiosk configuration, or hardware/MDM controls outside Electron. |
