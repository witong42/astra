---
title: Saved mini-app protocols survive the Astra namespace rename
author: Witong
date: 2026-10-24
branch: main
id: l-0aaf0e5b
scope: repo
status: active
src: agent
touches:
  - ".github/assets/astra-pitch-en.mp4"
  - ".github/assets/astra-pitch-en.vtt"
  - ".github/assets/film-poster.png"
  - CONTRIBUTING.md
  - README.fr.md
  - README.md
  - THIRD_PARTY_NOTICES.md
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
---

## Decided
Cue: renaming the product namespace in `src/main.ts`, `src/preload.ts` and `src/canvas-runtime.ts` also changes identifiers already stored outside the source tree.
Lesson: use Astra for active IPC, globals, build identifiers and new profiles; resolve the saved profile before choosing a new default, and retain the old mini-app input/result events and name fences so stored apps and resumed sessions remain readable. New explicit environment variables take precedence. Do not move a profile while its installed app is writing it.
Evidence: one isolated replay compared the actual mechanical rename of the previous main-process directory expression with `src/config.ts`, using the same three inputs, Bun/local-file tools and one run per implementation. The mechanical baseline failed the existing legacy profile and legacy explicit override cases; both implementations passed the new override case. The candidate passed all three. `tests/config.test.ts`, `tests/canvas.test.ts`, `tests/canvas-events.test.ts` and `tests/sessions.test.ts` verify the saved-data contracts. This supports this rename only; transfer to a different task remains unverified.

## Tried and ruled out
Replacing every persisted string without a compatibility path loses the existing profile and leaves saved HTML listening for events that are no longer dispatched. Creating an empty Astra directory is not evidence of a migrated profile.

## Watch out
Legacy notification aliases must not execute a native action twice: the trusted action is requested once, and its result is delivered under both event names. Historical raw captures and existing user data are not source files to rewrite.
