---
title: Local microphone recognition needs minimum audio ducking
author: Witong
date: 2026-10-24
branch: main
id: l-20c6fc56
scope: repo
status: active
src: agent
touches:
  - native/Voice.swift
  - native/VoiceTests.swift
  - tests/native-voice.test.ts
---

## Decided
Configure native/Voice.swift input processing with advanced ducking disabled and the minimum other-audio ducking level, retaining voice processing and echo control. The local Home/wake recognizer is a separate audio engine from CodexLiveMedia. Apple's voice-processing API treats audio rendered outside that engine, including other apps and the separate live voice player, as other audio. This is a plausible contributor when music and Astra speech change loudness together.

## Tried and ruled out
The user's system output remained at 88 percent while reporting both streams varied together. Do not raise or lower that volume to mask this report, or disable echo processing without checking recognition regressions. A bounded AVAudioInputNode readback probe showed the old configuration was advanced=false, level=default; the candidate was advanced=false, level=min, voiceProcessing=true. The same native replay check fails on the former default and passes with configureVoiceInput applying minimum ducking. These results verify the configuration, not an audible cure.

## Watch out
Minimum ducking is not zero ducking. Do not say automatic attenuation is completely disabled. The separate Codex voice runtime may have its own processing outside this helper. Verify the installed helper hash and listener readiness after restart, then confirm both streams with the user's ears. Primary API reference: https://developer.apple.com/documentation/avfaudio/avaudioinputnode/voiceprocessingotheraudioduckingconfiguration and Apple's WWDC23 session 10235.
