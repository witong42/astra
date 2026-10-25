---
title: A Bun shebang can silently break the installed Node CLI
author: Witong
date: 2026-10-25
branch: main
id: l-c46c9b9b
scope: repo
status: active
replaces: l-67d2be20
src: agent
touches:
  - src/astra-cli.ts
---

## Decided
Build the packaged astra CLI for Node and omit the env-bun shebang in src/astra-cli.ts. scripts/build.ts targets Node; the Windows astra.cmd shim runs the bundle through Electron with ELECTRON_RUN_AS_NODE, without requiring Bun. tests/astra-api.test.ts verifies an actual JSON API reply from that runtime. This replaces l-67d2be20 to associate the learning with the CLI source rather than an unrelated dirty asset.

## Tried and ruled out
A target-only change was insufficient: keeping the Bun shebang retained a Bun-specific @bun-cjs wrapper for both build targets. Electron exited zero with no output. Removing the shebang and building for Node returned the expected response. The same-model, same-tools, five-second comparison in test-results/windows-port/cli-runtime-check.json did not support a general guidance change before the shebang cause was isolated.

## Watch out
Starting Astra does not verify its CLI. Exercise the installed astra.cmd as the interactive Windows user, check its JSON, and verify connected status and persisted app IDs. A zero exit code alone missed this failure. Keep test profiles and the existing Mac profile distinct.
