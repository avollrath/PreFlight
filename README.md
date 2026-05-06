# PreFlight

PreFlight is a Windows-first Electron productivity gate. It opens as a focused checklist overlay so you complete a small daily routine before continuing to the desktop.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run start
npm run package
npm run dist
```

`npm run package` creates an unpacked Windows build in `release/`. `npm run dist` creates the Windows installer target.

## Development

The MVP includes a visible Dev Unlock button so development builds are recoverable while fullscreen locking behavior is added.

## Windows Startup

Open Settings in PreFlight and enable **Start PreFlight when Windows starts**. The toggle uses Electron's login item support for the current Windows user.

## Workstation Unlock Task

Package the app first:

```bash
npm run package
```

Then install the current-user unlock task from PowerShell:

```powershell
.\scripts\windows\install-wakeup-task.ps1
```

If the executable is somewhere else, pass it explicitly:

```powershell
.\scripts\windows\install-wakeup-task.ps1 -AppPath "C:\Path\To\PreFlight.exe"
```

Remove it with:

```powershell
.\scripts\windows\uninstall-wakeup-task.ps1
```

The MVP uses the reliable workstation unlock trigger. Wake-from-sleep event timing varies across Windows hardware and power states, so unlock is the recovery trigger for this version.
