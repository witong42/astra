---
title: Platform support changes need complete marketing coverage
author: Witong
date: 2026-10-25
branch: main
id: l-d9f2bc2a
scope: repo
status: active
src: agent
touches:
  - website/copy.ts
  - website/index.html
  - README.md
  - README.fr.md
  - tests/marketing.test.ts
---

## Decided
Cue: the user pointed out that Windows packaging existed while `website/copy.ts`, `website/index.html`, `README.md` and `README.fr.md` still described a Mac-only product. For a platform-support update, check the visible availability, primary action, install instructions, social description and both READMEs against the actual package, as well as translation-key parity.
Evidence: one bounded, replay-safe comparison on the same frozen marketing snapshot, with the same active Codex session, Bun checks and a three-second ceiling. The baseline parity check accepted the defective Mac-only copy. The candidate platform-coverage checks rejected it; after the correction, they accept both languages, while parity remains passing. `tests/marketing.test.ts` also builds an isolated version 99.1.2 fixture to verify that the Windows link matches the packager's versioned ZIP naming. Local evidence: `test-results/windows-marketing-guidance-probe.json` and the desktop/phone browser report.

## Tried and ruled out
Working Windows code, a complete translation dictionary and a small coming-soon note did not update the product presentation. Do not hardcode a Windows ZIP version independently of package.json. The existing Mac command remains a Mac-specific install option.

## Watch out
This verifies the messaging and installation route, not publication or runtime validation of a release artifact. Keep the Site's existing audience. Linux is portable in principle but its native voice build and packaging remain unsupported; do not advertise an untested Linux download. Transfer of this guidance to another task remains unverified.
