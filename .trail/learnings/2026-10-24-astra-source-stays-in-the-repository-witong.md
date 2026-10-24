---
title: Astra source stays in the repository and captures stay in .astra
author: Witong
date: 2026-10-24
branch: main
id: l-41bedfbb
scope: repo
status: active
src: agent
touches:
  - assets/astra-logo-three-branches-starry-v1.png
  - package.json
  - scripts/build-web.ts
  - scripts/desktop-client.ts
  - scripts/package.ts
  - src/backend.ts
  - tests/backend.test.ts
  - tests/desktop-client.test.ts
  - tests/package.test.ts
---

## Decided
Keep implementation changes such as src/backend.ts and scripts/build-web.ts in the active Astra Git checkout. src/storage.ts reserves ~/.astra for personal app data and generated tools; raw demo captures can also live there. Curated media referenced by README.md belongs in .github/assets. Preparing a README and useful setup does not require a promotional campaign.

## Tried and ruled out
A temporary source clone under ~/.astra/launch/source avoided concurrent edits, but mixed the source location with the application's personal data directory. The user explicitly questioned that location and rejected marketing work. Keep the original checkout as the source of truth and preserve other sessions' changes rather than creating a second source tree in ~/.astra.

## Watch out
Cue: a task needs both application source edits and generated evidence. Lesson: check that implementation paths are inside the active Git workspace and raw captures are outside it before reporting completion. Evidence: one isolated placement-check replay, unchanged active agent model, no inference calls, Bun filesystem tools and a two-second budget per check. The baseline existence check accepted the misplaced source clone; the candidate source-ownership check rejected the same fixture. Both accepted the repaired repository source with the same capture path. This validates the acceptance check only; transfer to a different task remains unverified.
