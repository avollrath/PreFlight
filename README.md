# PreFlight

A Windows Electron app that blocks my desktop until I finish a checklist.

I built this because I kept sitting down at my computer and immediately opening Slack, email, or YouTube before doing anything I meant to do. I wanted a little wall in front of the desktop: drink water, check the calendar, pick priorities, then start. PreFlight is that wall.

![PreFlight lock screen](src/assets/preview.jpg)

When the PC boots or wakes, PreFlight can open as a fullscreen lock screen. I check off the list, and when the last item is done the overlay closes and the desktop comes back. If I need to change the list, I do that in setup mode.

## Features

### Lock screen

- Fullscreen overlay that blocks closing, minimizing, and common task-switching shortcuts
- Blocks secondary monitors too, with an option to leave them usable for things like Spotify
- Three.js animated neon corridor background built with WebGL
- Unlocks automatically when the last item is checked
- Can start automatically on Windows boot and wake from sleep

### Checklist & settings

- Add, edit, and remove checklist items in setup mode
- Completion state resets daily
- Secondary screen blocking toggle
- Settings panel that looks different from the lock screen, so I always know which mode I am in

## Getting Started

```bash
npm install
npm run dev
```

To build:

```bash
npm run build
npm run start
```

## Dev Modes

| Command | What it does |
| --- | --- |
| `npm run dev` | Normal dev mode with lock enabled. |
| `npm run dev:debug` | Windowed debug mode with DevTools, no secondary blockers. |
| `npm run dev:safe` | Alias for `npm run dev:debug`. |

## How The Lock Works

PreFlight uses Electron kiosk windows, always-on-top overlays, focus recapture, monitor bounds clamping, and global shortcut registration. On Windows it also kills `explorer.exe` while locked, which removes the taskbar, Start menu, and desktop shell. Explorer is restored when the checklist unlocks, when lock mode exits, and from app quit/error handlers.

It cannot block `Ctrl+Alt+Del`, `Win+L`, firmware keys, or anything that belongs to Windows below the app layer. That is fine. This is a tool for honest self-accountability, not a prison. If I really want out, I can sign out of Windows; that is enough friction for the use case.

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

## Resetting Data

PreFlight stores checklist items, daily completions, and settings in Electron's `userData` folder as `preflight-store.json`. To reset it on Windows, close the app and remove the folder:

```powershell
Remove-Item "$env:APPDATA\PreFlight" -Recurse -Force
```

## Packaging

```bash
npm run package
```

This creates:

```text
release/win-unpacked/PreFlight.exe
```

```bash
npm run dist
```

This creates the installer target.

## Workstation Unlock Task

There is also a Task Scheduler helper for launching the packaged app when the workstation unlocks. Package the app first, then run:

```powershell
.\scripts\windows\install-wakeup-task.ps1
.\scripts\windows\install-wakeup-task.ps1 -AppPath "C:\Path\To\PreFlight.exe"
.\scripts\windows\uninstall-wakeup-task.ps1
```
