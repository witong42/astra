---
title: Electron Retina filenames report logical rather than pixel sizes
author: Witong
date: 2026-10-25
branch: feature/astra-0.6.0
id: l-a29a1cb7
scope: repo
status: active
src: agent
touches:
  - native/Voice-Info.plist
  - native/Voice.swift
  - native/VoiceTests.swift
  - scripts/build.ts
  - scripts/package-files.ts
  - src/main.ts
  - src/native-speech.ts
  - tests/icon.test.ts
  - tests/native-voice.test.ts
  - tests/package.test.ts
---

## Decided
Cue: replacing the Swift bitmap assertion in tests/icon.test.ts with Electron nativeImage produced bounds 190 511 instead of the existing 100 923 golden. For exact pixel checks, create the nativeImage from the PNG buffer rather than an @2x filename. Keep the transparency, 1024x1024 dimensions and opaque-center assertions. This removes the Swift test dependency without weakening its checks.

## Tried and ruled out
A bounded baseline/candidate replay used the unchanged active Codex session (zero inference calls), Bun 1.4.3 and Electron 45.0.0, the same copied dock PNG named icon_512x512@2x.png, and 15000 ms per trial. The filename baseline reported 512x512 logical dimensions and bounds 190 511. The buffer candidate reported 1024x1024 and bounds 100 923; both preserved a transparent corner. Retain the candidate for this pixel test only; this is not evidence of general agent performance improvement.

## Watch out
nativeImage filename scale handling and bitmap pixel storage differ. Do not change the golden coordinates to accommodate logical dimensions. The separate native-voice test now exercises RendererAudio and an actual hidden Electron window with simulated media, echo cancellation and two capture/release cycles; it does not establish physical microphone or acoustic echo quality. Transfer of this guidance to a different subsequent task remains unverified.
