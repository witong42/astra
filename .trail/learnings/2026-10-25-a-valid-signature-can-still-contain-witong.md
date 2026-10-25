---
title: A valid signature can still contain mixed IPC generations
author: Witong
date: 2026-10-25
branch: main
id: l-88480842
scope: repo
status: active
src: agent
touches:
  - src/main.ts
  - src/preload.ts
  - scripts/build.ts
  - scripts/package.ts
  - install.sh
---

## Decided
Cue: after a namespace rename, the installed desktop reports that codexos:snapshot has no registered handler. Lesson: verify the renderer's actual snapshot call against the packaged main process before activation; then install the complete verified bundle by directory replacement. A valid signature does not prove that manually copied and re-signed JavaScript files belong to the same build.
Evidence: the failing installation contained a new astra IPC main.cjs with the older codexos preload.cjs and renderer.js. Its strict deep signature check passed. One bounded guidance replay used the same Codex session, Bun/macOS/Electron tools, fake Codex account, isolated profile and twenty-second budget on both this mixed bundle and the complete replacement. Signature-only validation accepted both. The candidate added a real packaged-renderer snapshot call: it reproduced the exact missing-handler error on the mixed bundle and passed on the complete replacement, with window.astra present, window.codexos absent, Home visible and no renderer exceptions. The normal user installation then reconnected with all thirteen saved app identities and the remote configuration preserved. This supports this deployment check; no general performance claim is established.

## Tried and ruled out
Adding a legacy IPC alias would conceal the mismatched installation and leave the old renderer and preload in place. Source tests and package metadata alone did not detect this installed-file mismatch. Replacing only main.cjs was not a complete application update.

## Watch out
`src/main.ts` flushes editors on normal quit. Keep the prior bundle and current user data, stage a full bundle, verify it, replace the stopped application, and compare runtime artifact hashes. Do not migrate the active data directory while voice is using it. The namespace rename also changes the bundle identifier: resolve the new identifier when selecting the running app for UI inspection.
