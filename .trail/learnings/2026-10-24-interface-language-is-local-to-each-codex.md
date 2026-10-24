---
title: Interface language is local to each device and independent of voice
author: Codex
date: 2026-10-24
branch: main
id: l-0590da48
scope: repo
status: active
src: agent
touches:
  - src/Astra.tsx
  - src/renderer.tsx
---

## Decided
The user approved a separate FR/EN preference on each device because changing the phone interface must not change the Mac interface. src/locale.ts stores only astra.interface-language in that origin's localStorage; no remote method, server setting or dependency is needed. src/LocaleProvider.tsx updates host copy while src/Astra.tsx keeps VoiceState.language for actual speech and transcripts. Existing mini-app names, authored content and recorded journal messages keep their language.

## Tried and ruled out
Using voice.language for interface labels is rejected because detected speech language would change the UI without the user's selection. A server preference is rejected because it would sync a setting that the user approved per device.

## Watch out
Locale changes must preserve iframe identity, OpenUI controls, drafts and canvas revisions. tests/locale-browser.test.ts checks both plain and hybrid apps, reload persistence and isolated device profiles. Checking retained values alone missed an offscreen journal because focusing its composer during the slide-in transition scrolled the hidden-overflow desktop body by 472px. src/renderer.tsx uses preventScroll on that focus. Retain the scroll-position assertion because preserved fields must also remain visibly usable.
