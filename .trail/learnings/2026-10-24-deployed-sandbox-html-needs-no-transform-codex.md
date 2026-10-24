---
title: Deployed sandbox HTML needs no-transform and frame error checks
author: Codex
date: 2026-10-24
branch: main
id: l-3cc1d1f9
scope: repo
status: active
src: agent
touches:
  - src/site-worker.ts
  - scripts/build-site-worker.ts
  - scripts/build-web.ts
  - tests/web-hosting.test.ts
---

## Decided
Cloudflare's JavaScript Detections injection caused the phone's cross-origin document SecurityError inside Astra's opaque canvas sandbox. Keep allow-scripts isolation and shared mini-app payloads. src/site-worker.ts sets Cache-Control: no-transform on both HTML responses; scripts/build-site-worker.ts embeds the existing assets in a Worker so that response headers survive hosting. The published canvas now retains its controls and weather data with no frame errors.

## Tried and ruled out
A static _headers file was copied into the build, but the deployed host still injected its challenge script. Local header mocks alone did not reveal this. The injected script creates a nested iframe and reads its document, which fails with opaque sandbox origins. Do not fix this by granting allow-same-origin or by changing mini-app data sharing.

## Watch out
Cue: the functional canvas probe passed even while the injected child script threw. Lesson: check actual deployed child HTML and assert that its canvas:error messages are empty alongside successful interactions. Evidence: the same isolated Bun/Electron probe, fixed model/tools and five-second budget accepted the captured failing page on functional output alone; adding the frame-error assertion rejected the exact SecurityError. Clean published HTML passed both checks. This is one bounded guidance comparison; transfer to a different task is not yet established. tests/web-hosting.test.ts can replay captured HTML with ASTRA_TEST_HOSTED_CANVAS without taking the phone's live backend lease.
