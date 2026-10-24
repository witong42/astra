---
title: Miniapp Astra should be a live galaxy rather than a PNG
author: Witong
date: 2026-10-24
branch: main
id: l-b7b8fd1e
scope: repo
status: active
replaces: l-68858a6e
src: agent
touches:
  - src/galaxy.ts
  - src/Astra.tsx
  - src/styles.css
---

## Decided
The user wants the Astra button inside miniapps to be animated in code, like the large Home galaxy. This supersedes the static round PNG proposal. The application icon remains a separate design problem: the smooth ribbon logo lost Astra's essence, and the later detailed star-galaxy images still did not feel sufficiently like an application icon. No new application icon is accepted.

## Tried and ruled out
Reframing the same detailed galaxy into a rounded square, then concentrating its core and arms, still failed the user's application-icon criterion. Do not repeat another photographic galaxy-in-a-square variation without resolving the graphic direction. An isolated HTML preview reused src/galaxy.ts mountGalaxy at 48 CSS pixels with the existing compact button styles. In the browser it produced 17 frames and 2852 changed backing pixels in 684 ms; with reduced motion it produced zero new frames and a stable image over 650 ms. These measurements establish motion and reduced-motion behavior in the preview, not production integration or CPU performance.

## Watch out
src/Astra.tsx compact mode still renders ./icon.png. The planned change is to reuse its existing Galaxy component there and adapt the compact image styles in src/styles.css to canvas. Preserve the Home action, voice labels, pointer interaction, visibility suspension and cleanup. Integration and a new application-icon direction await user review. test-results/astra-button-preview.html is a self-contained throwaway preview, not an installed feature. assets/astra-icon-proposal.png and assets/astra-round-proposal.png are unapproved candidates and should not ship.
