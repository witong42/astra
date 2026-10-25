---
title: Keyword-only wake recognition needs buffered WebRTC audio
author: Witong
date: 2026-10-24
branch: main
id: l-50732b0a
scope: repo
status: active
src: agent
touches:
  - ".github/assets/astra-pitch-en.mp4"
  - ".github/assets/astra-pitch-en.vtt"
  - ".github/assets/film-poster.png"
  - README.fr.md
  - README.md
  - THIRD_PARTY_NOTICES.md
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
  - native/SpeechRecognition.swift
---

## Decided
Use the same Vosk 0.3.50 keyword recognizer for Mac and phone PCM. Keep the full initial request in bounded local audio history, bookmark its aligned Astra start, and stream that prefix plus later capture once through an app-controlled WebRTC track. The Mac helper retains voice processing, mono microphone extraction and fixed minimum ducking; it does no dictation. Phone capture retains its own absolute sample positions and direct browser-to-Codex audio.

## Tried and ruled out
The current GPT-Live V3 path acknowledged thread/realtime/appendAudio but then rejected input_audio.append asynchronously. The Codex voice host has no PCM-injection command. Replaying a prefix and switching immediately to raw live input would lose speech captured during the prefix. Use one continuous bounded PCM queue instead. Starting on an unqualified Astra partial also woke on astronaut; retaining a short acoustic boundary or a following token passed the negative corpus.

## Watch out
Cue: replacing full local dictation with keyword recognition. Lesson: prove a full wake-plus-request after delayed WebRTC startup before removing the former recognizer; an RPC acknowledgement, SDP or connection flag is insufficient. One isolated guidance comparison kept the same Bun tools, model and ten-second budget: the old text-dependent handoff failed the replay scenario, the candidate passed without a duplicate text turn or greeting. A distinct live test delivered the whole initial phrase once after a three-second connection delay and handled local Home during assistant output with inbound RTP. This is bounded transfer evidence, not a general improvement claim. Keep unknown tokens through the standalone Home decision and reject the first incomplete utterance after dropped PCM. Paired replay on the same human recording reduced Home by 500 ms; Astra plus a request improved by 700-800 ms on the two synthetic clips. Standalone Astra on the human clip did not improve. Native Windows execution remains deferred by the user; tests/native-runtime.ts carries the same portable corpus. Physical Mac feedback is a separate check.
