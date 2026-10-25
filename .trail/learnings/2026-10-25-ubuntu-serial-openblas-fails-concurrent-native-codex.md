---
title: Ubuntu serial OpenBLAS fails concurrent native voice calls
author: Codex
date: 2026-10-25
branch: main
id: l-cb712e9e
scope: repo
status: active
src: agent
---

## Decided
Cue: the first real Linux recording corpus aborted with Kaldi SymPosSemiDefEig after the build, matrix inverse checks and software tests passed. Use Ubuntu's libopenblas-pthread-dev static library for Astra's Linux voice build. scripts/build-voice.ts rejects the serial pkg-config variant and records the math backend in runtime.json. tests/linux-build.test.ts runs the recorded corpus in Electron's actual Node runtime, including concurrent English/French recognizers.
Evidence: Ubuntu 26.04 ARM64, OpenBLAS 0.3.32+ds-5. Replacing only the serial OpenBLAS archive in the link command, with the same prepared Vosk/Kaldi objects, JavaScript and recordings, changed Electron from native abort to 96/96 passes. The permanent build then passed the same corpus in Electron and Bun, plus 280 Linux tests. Evidence is in test-results/linux-port/pthread-probe.log, concurrent-voice-test.log and linux-suite.log.

## Tried and ruled out
Bun alone was not the cause: Electron also aborted. Direct C++ decoding passed 48 short-fixture mode iterations, so that probe did not reproduce the FFI scheduling boundary. An isolated JavaScript variant that serialized dual-language accept/finish passed 96/96, but the production repair keeps concurrent recognition and changes the math backend. SINGLE_THREADED configuration does not establish whether USE_LOCKING was enabled; do not claim that flag was proved absent.

## Watch out
Pinned Kaldi also needs official LAPACK wrapper macros for trailing Fortran character lengths and position-independent static objects when linked into libvosk.so. The float/double inverse and shared-link checks catch those separate failures. Keep the native assertions enabled. A model that loads, a connected audio transport and a passing software suite do not prove audible microphone/reply/Home behavior; keep the physical check separate.
