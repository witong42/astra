---
title: A framed motion edit needs visible window movement
author: Witong
date: 2026-10-25
branch: main
id: l-9914a860
scope: repo
status: active
src: agent
touches:
  - tests/marketing.test.ts
---

## Decided
Cue: the user selected the earlier blue composition, then explicitly requested a prettier layout and more motion. Check the visible app frame as well as camera crops in `tests/marketing.test.ts`; stable crops alone do not establish movement of the composition.
Evidence: one isolated Bun/Canvas replay, same model and tools, five phases per scene and a one-second evaluation ceiling. The previous composition had zero window displacement in all six scenes; the candidate moved the frame more than twelve pixels in all eight. The original smooth-crop checks were retained. This supports the current layout check, not a general creative-quality claim.

## Tried and ruled out
Counting cuts alone cannot verify this request. The first blue render also had a 4.5-second quiet visual stretch; the timer payoff needed a stronger window move and a visible code-card exit.

## Watch out
The user approved direction A; that supersedes the earlier rejection of a different fixed edit. Keep the accepted audio unchanged. Creative approval still belongs to the user after watching the actual movie.
