---
title: Phone ownership suspends native autosaves
author: Codex
date: 2026-10-24
branch: main
id: l-ea63907e
scope: repo
status: active
replaces: l-3ed1e091
src: agent
touches:
  - src/main.ts
  - src/remote-server.ts
  - src/renderer.tsx
  - src/CanvasSurface.tsx
  - tests/remote-server.test.ts
---

## Decided
Astra's CanvasAck revision orders Codex patches; it is not a device-ownership version. A hidden native canvas can still submit its older DOM at the same revision as the phone. Flush the native renderer before accepting the phone event stream, suspend its mounted editors, and ignore late native persistence calls while the phone owns the UI. Closing the phone connection remounts the native views from the current backend snapshot. Keep one phone connection active at a time.

## Tried and ruled out
Do not treat broadcasting a new Snapshot as proof that every mounted iframe rehydrated: CanvasSurface deliberately preserves the current DOM when the patch revision has not advanced. Do not increment patch revisions on every local mutation, which would repeatedly restart live mini-app scripts. The isolated runtime check filled a phone field, attempted a stale native write, disconnected the phone, and verified the saved phone value in the resumed native interface.

## Watch out
src/main.ts owns the handoff; src/remote-server.ts waits for its connecting callback before sending ready. src/renderer.tsx unmounts the suspended native surfaces. Phone voice uses browser WebRTC through the existing Codex subscription and 16 kHz Float32 PCM to the native Home recognizer. Preserve local Home resets, duplicate suppression and minimum native audio ducking. Browser RTP and synthetic PCM replay are not physical-phone or locked-screen evidence.
