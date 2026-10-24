---
title: Home recognition must discard ordinary speech after silence
author: Witong
date: 2026-10-24
branch: main
id: l-5503173c
scope: repo
status: active
src: agent
touches:
  - native/Voice.swift
  - native/VoiceTests.swift
  - tests/native-voice.test.ts
---

## Decided
In native/Voice.swift, run Home endpoint detection on the English transcription lane, independently of the French lane's score. Reset recognition after every completed ordinary utterance, as well as after a Home command. Use the same endpoint handling during standby and the Home-only live-call listener, and cancel pending timers on wake, rotation and stop.

## Tried and ruled out
Keeping the local listener alive was necessary but insufficient. The prior code only reset standby recognition after a detected command or its 48-second rotation; SpeechRecognition.swift accumulates finalized text. Therefore earlier conversation could remain before the next Home and prevent an exact match. Ranking Home against a French transcription could also reject the English command. A bounded fixed-input replay in native/VoiceTests.swift failed with the former Home-only reset policy (ordinary conversation was not cleared) and passed after resetting on silence. The candidate also covers repeated Home after conversation, French results arriving later, Home Assistant cancellation and stale timers after stop.

## Watch out
The 22 focused tests pass, including real synthesized French/English/Home audio and the native timer replay. A full run passed 149 checks before the final shared standby/live wiring adjustment; rerun the focused checks after that adjustment. These checks do not prove physical microphone recognition during the user's live call. Verify the installed helper hash and readiness after restart, then have the user say Home, pause, reopen a mini-app and repeat after ordinary conversation. Do not change system volume to mask an unlocalized audio-volume report.
