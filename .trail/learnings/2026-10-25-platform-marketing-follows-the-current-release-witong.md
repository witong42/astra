---
title: Platform marketing follows the current release package
author: Witong
date: 2026-10-25
branch: main
id: l-949e8f96
scope: repo
status: active
replaces: l-d9f2bc2a
src: agent
touches:
  - website/copy.ts
  - website/index.html
  - README.md
  - README.fr.md
  - tests/marketing.test.ts
  - scripts/build-marketing.ts
---

## Decided
Cue: the user reported Linux support after the earlier Windows marketing correction. Refresh the platform list and archive contract from the current packager before changing `website/copy.ts`, `website/index.html`, `scripts/build-marketing.ts`, `README.md` and `README.fr.md`. Preserve complete EN/FR coverage of the hero, install options, metadata and README. Package availability in an older learning is a dated observation, not a permanent product constraint.
Evidence: the current `scripts/package-linux.ts` builds an ARM64 `.deb`, and the native voice builder now has a Linux implementation. One bounded comparison used the same frozen Mac/Windows marketing snapshot, active Codex session, Bun tools and three-second ceiling: the previous two-platform check accepted the missing Linux presentation; retaining it and adding the current Linux ARM64/deb checks rejected that snapshot and passed after the correction. Existing translation parity and curated-media checks remain. An isolated version 99.1.2 build checks both Windows ZIP and Linux deb URLs. Local evidence: `test-results/linux-marketing-guidance-probe.json`.

## Tried and ruled out
The previous learning correctly required full platform coverage but its Linux-unavailable observation is now superseded. Do not advertise Linux x64 or invent an installer format when the release packager currently produces ARM64 `.deb`. Keep URLs tied to package.json rather than duplicating a release version.

## Watch out
This is a transfer check from the earlier Windows task to the subsequent Linux marketing task, not evidence of general agent improvement or independent runtime approval. Preserve the existing Site audience, current logo/font work and decorative galaxy. Static download-link verification does not publish a release or prove a physical Linux installation.
