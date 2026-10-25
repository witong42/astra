---
title: An env-bun shebang overrides a Node-targeted CLI bundle
author: Witong
date: 2026-10-25
branch: main
id: l-67d2be20
scope: repo
status: active
src: agent
touches:
  - THIRD_PARTY_NOTICES.md
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
  - install.sh
  - native/SpeechRecognition.swift
  - native/Voice-Info.plist
  - native/Voice.swift
  - native/VoiceTests.swift
  - package.json
---

## Decided
Build the packaged astra CLI for Node and omit the env-bun shebang in src/astra-cli.ts. The Windows astra.cmd shim uses the bundled Electron in ELECTRON_RUN_AS_NODE mode, so the installed CLI does not require Bun. Validate the JSON response, not merely process exit status. tests/astra-api.test.ts exercises the compiled CLI in Electron's actual Node runtime.

## Tried and ruled out
Changing only Bun.build target to node in scripts/build.ts did not fix the CLI. With the Bun shebang, both build targets retained a Bun-specific @bun-cjs wrapper; Electron exited successfully with no output. Removing the shebang and building for Node returned the expected API JSON. The fixed-model, fixed-tool five-second comparison is recorded in test-results/windows-port/cli-runtime-check.json; it did not justify a general guidance change before the shebang cause was isolated.

## Watch out
A Windows app that starts correctly does not prove its CLI works. Test the installed astra.cmd under the real user account, with Bun absent from the invocation, and verify that status returns the connected app and persisted mini-app IDs. Keep test profiles and the user's existing Mac profile distinct.
