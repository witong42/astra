---
title: Small KWS must pass isolated keywords before replacing Apple Speech
author: Witong
date: 2026-10-24
branch: main
id: l-29773ed3
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
  - package.json
  - scripts/build-marketing.ts
  - scripts/render-pitch.ts
---

## Decided
Cue: selecting one offline wake/Home recognizer for macOS and Windows based on model download size.
Lesson: require isolated Astra and Home, accented positives, and confusable-word checks before replacing native/SpeechRecognition.swift. The 5.3 MB English GigaSpeech KWS model is not accepted for integration on synthetic-file evidence alone. Preserve native/Voice.swift's standalone Home rule; a keyword hit does not prove an utterance is a Home command.
Evidence: local report /Users/william-mbp/.astra/captures/sherpa-kws-2026-10-24.json records the 18-case corpus, WAV hashes, parameters and results. Sherpa v2.0.0 macOS arm64 with the GigaSpeech 3.3M 2024-01-01 INT8 model passed its three official sample keywords. Seven intended-positive cases yielded only two detections: English Astra alone and in a phrase. French Astra and standalone Home were missed. The baseline also triggered on English homepage and astronaut.

## Tried and ruled out
One bounded guidance trial: prefer a more sensitive score 1.5 / threshold 0.1 instead of baseline score 1 / threshold 0.25. Both replayed the same frozen 18 WAV files with identical model weights, tokenizer, CPU CLI and an 18-decode budget per variant. Candidate recall remained 2/7; the astronaut false trigger remained, although homepage stopped triggering. The candidate did not pass acceptance, so retain no new recommended settings or global skill edits. This does not establish a general harness improvement; transfer has not been checked.

## Watch out
These are Daniel/Jacques synthesized voices, not a human microphone or Windows validation. The model files total about 5.3 MB, but the unmodified single-architecture file CLI plus required ONNX Runtime library total about 45.2 MB. Peak process RSS in this corpus was about 72.3 MB. File processing time is not streaming trigger latency. No Astra app source or installed app was modified for this probe. Preserve audio handoff and echo cancellation when a future recognizer integration is separately approved.
