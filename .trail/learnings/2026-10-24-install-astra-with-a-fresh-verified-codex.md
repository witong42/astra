---
title: Install Astra with a fresh verified bundle rather than an overlay copy
author: Codex
date: 2026-10-24
branch: main
id: l-cce18fe0
scope: repo
status: active
src: agent
touches:
  - scripts/package.ts
  - src/main.ts
---

## Decided
Install the complete prepared Astra.app into a new staging directory, verify its code signature, then replace the stopped /Applications/Astra.app by directory rename. Use this sequence because an overlay ditto update from packaged 0.2.2 to packaged 0.3.0 failed codesign --verify --deep --strict even though both prepared releases were valid. A fresh staging copy and whole-directory replacement passed signature verification and runtime-artifact hash checks. The specific resource responsible for the overlay failure was not retained after rollback; do not claim it was identified.

## Tried and ruled out
Do not merge a new release over an existing installation because a successful copy is not proof of a valid sealed bundle. A failed overlay was rolled back to the verified 0.2.2 release before the fresh replacement. Never weaken signature checks or re-sign the merged result to hide a mismatch.

## Watch out
src/main.ts flushes native and phone editors on graceful quit before saving workspace.json. Request a normal quit and wait for exit because force-killing can lose the latest edit. Keep the verified prior release available until the new one reconnects. Compare the current saved mini-app identities, names and remote configuration across installation; do not restore an older inventory from a previous turn because the user may have changed it meanwhile. This activation retained all 12 mini-apps present immediately before shutdown and verified FR/EN in the installed 0.3.0 build 5 interface. For stdin programs use bun -; bare bun can print help with exit code zero without executing the program.
