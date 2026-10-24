---
title: "Smooth spiral icons lose Astra's galaxy identity"
author: Witong
date: 2026-10-24
branch: main
id: l-68858a6e
scope: repo
status: active
src: agent
touches:
  - assets/astra-icon.png
  - scripts/icon.ts
  - src/Astra.tsx
---

## Decided
The user rejected the smooth, solid three-arm spiral proposals because they lost Astra's essence. Do not treat those designs as accepted artwork. The current application icon is still assets/astra-icon.png.

## Tried and ruled out
The first imagegen prompts replaced the original stars with broad luminous ribbons. The resulting square and round proposals were explicitly rejected: "on perd l'essence d'astra". A second bounded pass from the same original artwork preserved individual star particles, the organic irregular arms, the warm-white core and the blue-white/amber palette. Those revised candidates visually restore the particulate structure; they have not been approved by the user. The comparison used the same imagegen tool and one generation per format; its internal model is not exposed, so no general harness improvement or global skill edit is claimed.

## Watch out
assets/astra-icon-proposal.png and assets/astra-round-proposal.png are review candidates only. Both generated at 1254 pixels square with transparent corners; scripts/icon.ts requires a 1024-pixel square application PNG. src/Astra.tsx currently loads the same ./icon.png in compact mode, so integration of an accepted round candidate also needs a distinct build asset. Keep visual acceptance, asset preparation and live installation separate.
