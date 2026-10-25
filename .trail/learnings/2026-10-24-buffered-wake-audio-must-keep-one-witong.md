---
title: Buffered wake audio must keep one continuous WebRTC track
author: Witong
date: 2026-10-24
branch: main
id: l-173d0e53
scope: repo
status: active
replaces: l-50732b0a
src: agent
touches:
  - src/voice.ts
  - src/live-media.ts
  - src/web-audio.ts
---

## Decided
Keyword-only recognition needs bounded PCM history and an aligned Astra bookmark. Send the prefix and later captured speech through one continuous WebRTC queue. Keep native Mac echo processing and minimum ducking.

## Tried and ruled out
GPT-Live V3 acknowledged appendAudio but then rejected input_audio.append asynchronously. Codex's voice host has no PCM injection command. Switching from prefix playback straight to raw live input loses speech captured during playback. An unqualified Astra partial also woke on astronaut.

## Watch out
Cue: replacing full local dictation. Require a complete initial request after delayed connection, without a duplicate text turn. One isolated guidance comparison used the same Bun tools, model and ten-second budget: the old handoff failed; buffered replay passed. A separate live test verified the complete phrase once after three seconds of delay, inbound RTP and Home during assistant output. Retain unknown tokens through the standalone Home check; discard incomplete utterances after PCM gaps. Paired replay saved 500 ms on the human Home recording and 700-800 ms on two synthetic Astra-plus-request clips; standalone human Astra did not improve. This is bounded evidence, not a general performance claim.
