---
title: Astra marketing uses direct copy without ornamental labels
author: Witong
date: 2026-10-25
branch: main
id: l-a96209a1
scope: repo
status: active
src: agent
touches:
  - website/copy.ts
  - website/index.html
  - website/site.css
  - README.md
  - README.fr.md
---

## Decided
Cue: the user requested removal of things that feel "vibe coded", specifically little arrows and precision texts. On Astra's public site, use plain action labels and concise product copy. Remove ornamental arrows, numbered gallery labels, decorative conversation bars, redundant screenshot/video captions, tilted screenshots and footer slogans. Apply the same edit to English, French and the HTML fallback in `website/copy.ts` and `website/index.html`; remove orphan CSS from `website/site.css`.

One bounded local guidance check replayed the same visible-copy requirement against the frozen before snapshot and the edited page with the same Bun/Chrome tools and viewport/language matrix. The baseline contained 15 arrow glyphs in HTML and nine in each locale; the candidate had none. Browser checks passed at 1440px and 390px in EN/FR, with no overflow or page errors. Gallery selection, language persistence, both clipboard commands and three architecture-specific downloads still worked. Evidence: test-results/editorial-cleanup-baseline/probe.json and test-results/editorial-browser.json. This supports this specific presentation rule; it is not evidence of a general model-quality improvement.

## Tried and ruled out
Do not hide clutter with CSS while leaving translations or fallback HTML unchanged. Do not replace deleted captions with new slogans. The user's request is a polish pass, not a new brand or a video retake.

## Watch out
Keep useful OS/architecture requirements, installer commands, accessible video captions, focus states and keyboard gallery controls. Put the concise file/command-access statement in readable body text, with the full explanation in the README. Preserve the current logo, font, decorative galaxy, demo audio/video and Site audience. User approval of the final visual result is separate from these local checks; transfer beyond this task remains unverified.
