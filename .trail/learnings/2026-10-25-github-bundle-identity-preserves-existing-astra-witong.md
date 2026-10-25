---
title: GitHub bundle identity preserves existing Astra data
author: Witong
date: 2026-10-25
branch: main
id: l-f81e94ea
scope: repo
status: active
src: agent
touches:
  - ".github/assets/banner-fr.png"
  - ".github/assets/banner.png"
  - ".github/assets/icon.png"
  - THIRD_PARTY_NOTICES.md
  - assets/astra-icon.png
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
  - install.sh
  - native/SpeechRecognition.swift
---

## Decided
Astra now uses io.github.witong42.astra and io.github.witong42.astra.voice, matching the personal open-source project at github.com/witong42/Astra. The identifier change does not migrate the user-data directory: src/config.ts continues to recognize the existing Application Support/CodexOS profile.

## Tried and ruled out
Do not treat remaining legacy identifiers in install.sh and its tests as an incomplete rename. Previously published releases still use local.astra.desktop. The installer accepts that identity for migration, rejects unrelated signed applications and prevents an already-migrated app from reverting to the legacy identity.

## Watch out
Build and install a complete signed bundle after a normal quit. Verify the app plist and helper signature together, plus a real packaged-renderer snapshot. This change passed seven installer/package tests, Biome and TypeScript; the installed app retained all thirteen mini-app identities and its control API responded. macOS permissions can be associated with the old identity. No existing profile, journal or remote configuration was renamed.
