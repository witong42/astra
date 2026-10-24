---
title: Home shortcuts need local recognition during live conversation
author: Witong
date: 2026-10-24
branch: main
id: l-0e0fa988
scope: repo
status: active
src: agent
touches:
  - native/Voice.swift
  - native/VoiceTests.swift
  - src/native-speech.ts
  - src/voice.ts
  - tests/voice.test.ts
---

## Decided
Keep a Home-only NativeSpeech listener active alongside CodexLiveMedia. The ordinary wake listener stops when the live call connects; the Home-only listener must not wake Astra or dispatch chat turns. Track readiness and stop the local microphone listener when the live call closes. Sources: src/voice.ts, src/native-speech.ts, native/Voice.swift.

## Tried and ruled out
Matching only a completed remote transcript passed synthetic single-word tests but failed the user's real conversation. The journal recorded "Home Home Maintenant, du coup, ça marche pas quand je suis en conversation avec toi" as one completed utterance. Replaying this scenario with local detection while assistant speech is active failed two checks on the previous code and passed all 21 voice tests after the change, using the same Bun fixtures and budget.

## Watch out
Test live-call recognition separately from standby recognition, merged utterances, repeated Home, late events, microphone cleanup and double navigation from local plus remote recognition. Report installed state separately from test results; physical recognition with the user's voice still needs confirmation after restarting the app. Transfer beyond this Home task is unverified.
