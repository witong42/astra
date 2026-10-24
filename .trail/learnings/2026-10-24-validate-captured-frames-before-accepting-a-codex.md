---
title: Validate captured frames before accepting a film render
author: Codex
date: 2026-10-24
branch: main
id: l-9c872801
scope: repo
status: active
src: agent
---

## Decided
website/media/render.cjs validates captured pixels before saving mini-app screenshots. DOM controls and canvas text bounds cannot establish that an offscreen Electron page has painted. Wait for fonts and painted frames, retry a uniform image, and reject it with an actionable error before exporting the film. The film document must declare UTF-8 so English quotation marks retain their encoding.

## Tried and ruled out
The first English pitch storyboard passed all 13 text-bound checks and its mini-app control checks, yet several captured apps were entirely white. Two paint notifications could still belong to a navigation transition. A captured-screen review exposed this; accepting the DOM and text report alone did not.

## Watch out
Cue: exporting product screenshots or a narrated film from offscreen Electron. Lesson: inspect the actual captured image and validate visible English text before accepting an export. Evidence: one isolated readiness-check comparison on the same saved failed/corrected storyboard fixtures, unchanged active model, Electron nativeImage tools, zero inference calls and a two-second budget per check. The baseline accepted the failed capture; a pixel-variation assertion rejected its exact uniform region (range 0) and accepted the corrected region (range 224.67). Existing text and control checks still pass. This supports this acceptance check; transfer to a different task remains unverified.
