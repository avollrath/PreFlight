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
