---
title: "Round the original galaxy by projection, not new spiral paths"
author: Witong
date: 2026-10-24
branch: main
id: l-08b8e881
scope: repo
status: active
replaces: l-b7b8fd1e
src: agent
touches:
  - native/Voice.swift
  - native/VoiceTests.swift
  - src/voice.ts
  - tests/voice.test.ts
---

## Decided
The user explicitly wants the animated miniapp button to keep the old galaxy's shape and motion, correcting only its oval proportions to become round. Preserve the original five authored trajectories, particle distribution, core, colors and animation. Separately, the user rejected the metallic A logo and requested a graphic galaxy in the spirit of ChatGPT's clean mark. No application icon or button integration has been approved yet.

## Tried and ruled out
Replacing the original curves with a new symmetric four-arm spiral was rejected: "l'ancien mais juste rond aulieu de ovale, pas une autre shape". Cue: a user asks to round an existing visual while preserving its identity. Lesson: change its projection and fit; verify the authored geometry is unchanged before judging circularity. Evidence: one isolated Bun comparison, same model/tooling and a five-second budget per variant, sampled the same five paths at 101 positions each. The rejected rewrite changed 404 samples and could not represent 101 samples from the fifth path. The projection-only candidate changed zero of 505 samples. The projected width/height ratio was 0.9937. This supports the preservation check in this task; transfer to another task is unverified.

## Watch out
The current preview in test-results/astra-button-preview.html stretches the original horizontal projection by 325/231 and fits it into a 56-pixel circle. It compares the original 48-pixel button with the corrected version. Browser checks verified motion and stable rendering under reduced-motion preference. This is a throwaway preview; production src/galaxy.ts, src/Astra.tsx and src/styles.css were not modified. Reuse the original Galaxy renderer with a compact projection if integration is accepted; do not bring back new spiral paths or change the Home galaxy. assets/astra-logo-proposal.png is the new graphic galaxy candidate, not approved installed artwork.
