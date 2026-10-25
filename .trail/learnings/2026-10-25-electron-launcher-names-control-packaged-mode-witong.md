---
title: Electron launcher names control packaged mode
author: Witong
date: 2026-10-25
branch: feature/astra-0.6.0
id: l-2cf044ca
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - package.json
  - scripts/package.ts
  - src/main.ts
  - src/renderer.tsx
  - src/styles.css
  - tests/locale-browser.test.ts
  - tests/main-voice.test.ts
  - tests/package.test.ts
---

## Decided

Installed macOS launchers must be named Astra and CFBundleExecutable must name that executable. Electron 45 computes app.isPackaged from the executable basename; a signed Astra.app whose main executable is still Electron is treated as a development app. This disabled both update IPC handlers and the update item in the tray. scripts/package.ts now renames the executable before signing. Existing local CLI launchers must resolve CFBundleExecutable rather than assume Electron.

## Tried and ruled out

Manifest, archive and strict signature verification accepted the old package, and its renderer loaded, but an actual packaged-runtime probe reported packaged=false. The same package test after the executable rename reported packaged=true with a complete renderer and matching version, with ELECTRON_FORCE_IS_PACKAGED unset. Do not substitute a tiny stand-in executable for this runtime check. Evidence: tests/package.test.ts, Bun 1.4.4, Electron 45.0.0; the installed b19 update check reproduced the development-build error before the repair.

## Watch out

Keep the packaged renderer probe on a private profile and distinct test bundle identifier. Replacing a production bundle must still preserve the complete previous app and saved profile. The tray uses the existing guarded update methods; a stale Check action must remain a check even if a download finishes, and late backend or update notifications must not recreate the tray after quitting starts.
