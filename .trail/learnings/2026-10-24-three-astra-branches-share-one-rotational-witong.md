---
title: Three Astra branches share one rotational master and a closed heart
author: Witong
date: 2026-10-24
branch: main
id: l-92db7cfd
scope: repo
status: active
src: agent
touches:
  - assets/astra-icon.png
---

## Decided
Cue: Astra's starry app mark uses three outer branches derived from the original folded-band motif. Keep one connected shape and a fully enclosed, regular central hexagonal heart. The three branches must share one master geometry rotated by 120 and 240 degrees. Opening the exterior does not authorize opening the heart. The current symmetric PNG in assets/astra-logo-three-branches-symmetric.png is a visual proposal, not an installed or approved replacement for assets/astra-icon.png.

## Tried and ruled out
Three oval loops or a trefoil changed the intended character. Detached open hooks destroyed the closed heart. Repeated symmetry requests against an asymmetric material reference still produced visibly unequal arcs. For this isolated image revision, a single exact rotational stencil followed by a texture-only imagegen call preserved the geometry more closely than the unconstrained reference edit.

## Watch out
Local probe: compare both 1254px images with the same navy-pixel threshold, central-opening flood fill and 120-degree overlap calculation. Baseline overlap was 0.5984 and candidate overlap 0.9783; center offset fell from 45.32px to 0.43px. Both hearts were closed. These are raster-region checks affected by stars and antialiasing, not a proof of exact vector equality. The exact guide is retained in test-results/astra-logo-three-branches-geometry.svg. Check transfer on a subsequent different task before treating the stencil workflow as a general improvement. Do not substitute another generated mark or deploy the app without checking the user's current visual selection and the active-call/concurrent-work state.
