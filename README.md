# PreFlight

PreFlight is a Windows-first Electron productivity gate. It opens as a fullscreen checklist overlay and asks you to complete a small daily routine before continuing to your desktop.

This MVP is intentionally safe for development: the **Dev Unlock** button is always visible, and `Ctrl+Shift+U` unlocks immediately.

## Features

- Fullscreen, frameless, always-on-top checklist overlay
- Daily checklist completion state stored locally
- Editable checklist items in the settings panel
- Unlock button enabled only when every item is complete
- Always-available Dev Unlock button
- `Ctrl+Shift+U` development unlock shortcut
- Windows login startup toggle
- Current-user Windows Task Scheduler helper for workstation unlock
- Windows packaging through electron-builder

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

`npm run dev` uses safe development mode. It opens a normal `1800x1000` resizable window, does not use fullscreen, does not stay always-on-top, and does not block close.

You can also run the safe script explicitly:

```bash
npm run dev:safe
```

Use debug mode when you want DevTools and verbose renderer diagnostics:

```bash
npm run dev:debug
```

During MVP development, use **Dev Unlock** or `Ctrl+Shift+U` if the window is in your way. The shortcut is handled in the Electron main process, so it still works if React fails to load.

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

If PreFlight opens black in development, press `Ctrl+Shift+U` first. Safe dev mode should quit immediately even if the renderer is broken.

Launch safe mode:

```bash
npm run dev:safe
```

Launch debug mode:

```bash
npm run dev:debug
```

Logs are printed in the terminal running the dev command. Normal dev logs the app startup and renderer target. Debug mode also logs renderer console messages, renderer load completion, and the development window safety state.

If you need to kill the app from PowerShell:

```powershell
Get-Process electron,PreFlight -ErrorAction SilentlyContinue | Stop-Process -Force
```

If the app behaves strangely after editing settings, reset local data with the `Remove-Item "$env:APPDATA\PreFlight" -Recurse -Force` command above.

## Windows Startup

Open **Settings** in PreFlight and enable **Start PreFlight when Windows starts**.

The toggle uses Electron's login item support for the current Windows user. In development it points at the current Electron process; in packaged builds it points at `PreFlight.exe`.

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
