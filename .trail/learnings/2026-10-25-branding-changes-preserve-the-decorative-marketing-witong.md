---
title: Branding changes preserve the decorative marketing galaxy
author: Witong
date: 2026-10-25
branch: main
id: l-cbca45ce
scope: repo
status: active
src: agent
touches:
  - ".github/assets/banner-fr.png"
  - ".github/assets/banner.png"
  - ".github/assets/icon.png"
  - THIRD_PARTY_NOTICES.md
  - assets/astra-icon.png
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
  - install.sh
  - native/SpeechRecognition.swift
---

## Decided
The user approved the blue dotted logo with an amber nucleus on white and asked to update the logo and typography everywhere. The later correction explicitly preserves the marketing spiral. Keep the decorative scene in src/galaxy.ts for website/site.ts and the full Home avatar; use assets/astra-logo.svg and src/brand-avatar.ts for the brand mark and compact Home button. Outfit is bundled locally through assets/brand.css and scripts/icon.ts; build-canvas.ts embeds it for the sandbox's existing data-font policy.

## Tried and ruled out
Replacing mountGalaxy with the brand icon confused a decorative illustration with a brand asset. Cue: the user said the marketing spiral had been replaced by mistake. Lesson: name the brand surfaces and the decorative scenes separately before applying a branding change, and verify the main illustration as well as the header mark.
Evidence: one bounded baseline/candidate comparison in the same active Codex session, unchanged model and browser tools, zero model calls, one scan of the same 140400 pixels at 390 by 844 per variant. The mistaken hero had 40.16 percent opaque white pixels; after restoring the original galaxy it had 0.28 percent, while the new header logo and Outfit remained. The original galaxy source and geometry tests are unchanged from HEAD. Local evidence: ~/.astra/media/logo-refresh/spiral-preservation-probe.json. This supports the current scope check; transfer to a different task is unverified.

## Watch out
A logo approval is not approval to replace animated illustrations or historical demo footage. Preserve voice, Home navigation and device-local interface language. Isolated renderer fixtures must copy the brand assets too; tests/locale-browser.test.ts otherwise reports missing logo images. The current branding choice supersedes older icon-artwork preferences for the mark only. Keep packaging, live installation and published Site state separately verified.
