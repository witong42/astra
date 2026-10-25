---
title: Preserve accepted audio during visual-only demo edits
author: Witong
date: 2026-10-25
branch: main
id: l-65d7d0dd
scope: repo
status: active
src: agent
---

## Decided
Cue: a visual-only edit in `website/media/astra-demo.html` regenerated its music/dialogue stream through `scripts/render-demo.ts` even though the captured voices and score source were unchanged. Guidance: when only the picture changes, stream-copy the accepted movie's audio and verify its compressed-stream hash before replacing `.github/assets/astra-demo-en.mp4`.
Evidence: one bounded comparison on the same 30-second edited footage and accepted audio, using the same active Codex session, Bun and FFmpeg, with a 60-second validation ceiling for each policy. Selecting the fresh renderer output failed the accepted-audio hash check; mapping edited video and accepted audio without re-encoding passed. Existing text, motion, duration, captions and browser playback checks were retained. Local evidence: `test-results/public-release-demo-evidence.json`.

## Tried and ruled out
Unchanged source recordings and score code do not establish byte-for-byte preservation of exported audio. Rebuilding the mix is unnecessary for a picture-only edit. Stream mapping needs no microphone or new recording.

## Watch out
This establishes packet preservation for this release edit only. Transfer and general creative quality remain unverified. Raw recordings stay outside Git. An unchanged audio hash does not establish loudspeaker playback or human approval. Trail's file-name check did not recognize these newly added renderer files; they exist in the working tree and are included with the release preparation.
