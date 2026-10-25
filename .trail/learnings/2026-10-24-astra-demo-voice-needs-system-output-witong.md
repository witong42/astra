---
title: Astra demo voice needs system output and smooth camera motion
author: Witong
date: 2026-10-24
branch: main
id: l-1ef81033
scope: repo
status: active
src: agent
touches:
  - ".github/assets/astra-pitch-en.mp4"
  - ".github/assets/astra-pitch-en.vtt"
  - ".github/assets/film-poster.png"
  - README.fr.md
  - README.md
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
  - package.json
  - scripts/build-marketing.ts
---

## Decided
Cue: the user reported that the demo linked from `website/index.html` and `README.md` had no Astra voice and felt jittery. In `scripts/render-demo.ts`, mix actual assistant system-output audio as well as the user request. Verify each speaker in the encoded movie, not only an audio-stream flag. The camera check in `tests/marketing.test.ts` replays stable, monotonic camera crops from `website/media/astra-demo.html`.

## Tried and ruled out
The previous export mixed only the user-request recording. screencapture -g records the default microphone input; the old reply capture peaked near -47.5 dB and did not provide usable speaker output. A fresh isolated Astra session and ScreenCaptureKit system-audio capture recorded its actual English confirmation. Beat-driven zoom resets, rotations, springs and stripe effects produced the nervous motion the user rejected. The same camera replay fails on the old draw code and passes on the smooth version. A timestamp-based unbounded dialogue pad ran past thirty seconds; sample-bounded padding/trimming, explicit output timestamps and a file/duration cap produced exactly thirty seconds.

## Watch out
The encoded-movie comparison found Astra waveform correlation 0.012 before the repair and 0.998 after mixing its actual reply, with speech about 24 dB above the remaining soundtrack during that line. These are output checks, not human approval of the mix or proof that it feels cool. Keep captures/profile data local and preserve other sessions' voice work. Synthetic demo instructions and encoded audio correlation do not establish human wake-word or phone accuracy. General guidance transfer remains unverified.
