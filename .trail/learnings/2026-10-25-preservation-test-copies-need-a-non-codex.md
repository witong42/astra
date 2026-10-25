---
title: Preservation test copies need a non-test extension
author: Codex
date: 2026-10-25
branch: main
id: l-0dc3c020
scope: repo
status: active
src: agent
---

## Decided
Cue: preserving tests/config.test.ts and its astraConfig checks under test-results/linux-port/baseline with the original .test.ts name made Bun's filename filter execute both copies. Append .snapshot to preservation copies and retain the original-name/hash mapping in the baseline manifest.

## Tried and ruled out
An ignored output directory did not prevent Bun from discovering the copied tests/config.test.ts. One bounded guidance comparison used the same active model with no extra model calls, Bun 1.4.3, the same read-only Windows configuration test and a five-second ceiling. Baseline names produced two files and two passes; .snapshot names produced one file and one pass. The intended Windows assertion passed in both. Evidence: test-results/linux-port/harness-snapshots.json.

## Watch out
This task-local lesson has not been checked on a different subsequent task. Preserve snapshots and hashes; do not delete unrelated source or user data to fix discovery.
