---
title: Architecture checks must run on the target CPU
author: Witong
date: 2026-10-25
branch: main
id: l-1d025a97
scope: repo
status: active
src: agent
touches:
  - install.sh
---

## Decided
Cue: the user requested Linux x64 after the first ARM64 package. Before expanding a platform claim, run `tests/linux-package.test.ts` on that CPU architecture; distinguish skipped tests from passing tests. `packageLinux` in `scripts/package-linux.ts` must select matching Koffi binaries, Debian metadata and voice manifests.

One bounded guidance comparison used the same package fixture in isolated baseline/candidate directories under Bun 1.4.4 on Debian x64 emulation, with the same tools and 30-second budget. The original ARM-only packager failed with "Build the Linux package on Linux ARM64." The candidate passed 25 assertions in 1.85 seconds. A separate native ARM64 container passed the same 25 assertions in 0.49 seconds. Logs: test-results/linux-x64/package-baseline.log, package-candidate.log and arm64-package.log. This supports the target-architecture check for this task; transfer to a different task remains unverified.

## Tried and ruled out
The original test skipped every non-ARM64 host, so it could not provide x64 evidence. Reusing ARM64 metadata or native modules for x64 is rejected. `scripts/package-linux.ts` now maps x64 to Debian amd64 and validates the voice runtime architecture before packaging.

## Watch out
The fixture uses real ELF placeholders and Debian tools. It verifies archive construction, interruption cleanup, sandbox permissions and architecture checks; it does not prove voice accuracy or desktop usability. Require the actual native build, recorded voice corpus and packaged launch before releasing a new CPU target. This guidance changes the project tracker only; it does not install Harness2 or alter global skills, access, billing or approval rules.
