---
title: Large reply snapshots must wait for a slow phone stream
author: Witong
date: 2026-10-24
branch: main
id: l-9f288274
scope: repo
status: active
src: agent
touches:
  - src/main.ts
  - src/remote-server.ts
  - tests/remote-server.test.ts
---

## Decided
Astra's complete saved app state can approach 16 MB. Voice replies update the journal and publish repeated full snapshots. In src/remote-server.ts, respect Writable backpressure and resume sending on drain; retain only the latest pending snapshot and voice state while preserving control commands. Keep the control-command queue bounded and skip commands whose receipt already expired. In src/main.ts, apply phone ownership to background and tray voice controls, and do not automatically reactivate desktop voice after the phone disconnects.

## Tried and ruled out
Protecting desktop starts alone did not fix the user's Android Brave report: the phone showed the private Mac connection interruption as soon as Astra replied. The previous 16 MB buffered-output cutoff closed a slow phone after two full snapshot updates. Isolated local replay with the actual saved app state reproduced that closure; the repaired server retained the phone through four updates. Smaller snapshot tests and independent WebRTC audio checks had passed while this control-channel failure remained.

## Watch out
Cue: voice transport works until the first assistant reply, especially with existing image-heavy mini-apps. Lesson: include a realistic large saved state and a paused receiver in phone-voice checks; test both gzip and plain streams, eventual latest-state delivery and a confirmed control command. Evidence: one bounded guidance-comparison cycle, unchanged agent model and Bun tools, no inference calls and the same 10-second per-test budget. The two slow-phone cases failed before backpressure handling and passed afterward; the final full suite passed 214 tests. This validates these regression checks, not physical Android playback or general transfer. Packaged and installed 0.3.5 build 10 from a fresh verified bundle; the local API, runtime artifact hash, 13 saved mini-apps and remote configuration were verified. A physical-phone retest remains necessary.
