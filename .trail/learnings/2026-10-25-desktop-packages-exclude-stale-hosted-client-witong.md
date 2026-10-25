---
title: Desktop packages exclude stale hosted client builds
author: Witong
date: 2026-10-25
branch: main
id: l-9c520d8f
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
Cue: preparing a public desktop release after building the personal phone client and marketing site in the same checkout. Verify desktop packaging with stale client, server and website directories present. Check both that the desktop runtime survives and that those web outputs are absent. scripts/package-files.ts applies the same boundary to the Mac and Windows packagers; tests/package.test.ts exercises real file copying with web sentinels.
Evidence: one replay-safe comparison in the same Codex session with Bun 1.4.3, the same filesystem fixture and a 1000 ms budget. A runtime-presence-only baseline accepted the old Windows copy; adding the web-output exclusion check rejected it. The repaired shared copy passed both checks. The package test also passed; transfer to another task is unverified.

## Tried and ruled out
Passing the Mac packager alone did not establish the Windows copy policy. Recursively copying all of dist can include a private phone build even when Git ignores dist.

## Watch out
Do not put a real backend URL or credentials into replay fixtures. Public desktop archives must not include built phone clients, hosted Worker output, marketing assets or user profiles.
