---
title: Approved Astra combines the three-branch starry icon and folded live orb
author: Witong
date: 2026-10-24
branch: main
id: l-179b8c52
scope: repo
status: active
replaces: l-41379dd8
src: agent
touches:
  - assets/astra-icon.png
  - src/Astra.tsx
  - src/galaxy.ts
  - src/styles.css
---

## Decided
Use assets/astra-logo-three-branches-starry-v1.png as the approved master and its 1024px export assets/astra-icon.png for packaging because the user approved both the logo and animated button for delivery. The logo combines the rich starry bevel and white app tile of the harmonized reference with the three connected branches and fully closed heart of the symmetric reference. This replaces the earlier application-artwork selection mentioned in the folding learning; its compact-galaxy geometry remains valid.

## Tried and ruled out
Flat navy fills, sparse symbolic stars and bright blue gradients lost the finish the user wanted. Six-loop clones, trefoils and disconnected hooks did not meet the three-branch construction. New generic spirals, global stretching and flattening were rejected for the mini-app button because only the original upper branch should fold downward.

## Watch out
The mini-app button is a live 56px canvas in src/Astra.tsx, using the compact profile in src/galaxy.ts. The Home profile stays intact. The compact join is smoothed in tangent and curvature, and 303 samples on the three untouched paths remain identical. Current verification passes 174 Bun tests, TypeScript and focused Biome checks; an isolated profile-inversion mutation fails three geometry tests. The user approved the rendered icon and interactive preview. Release 0.2.2 build 4 packages those approved changes. Preserve the phone flush on graceful quit and keep unrelated staged web-hosting work out of the branding commit because the phone can own the active app during a desktop update.
