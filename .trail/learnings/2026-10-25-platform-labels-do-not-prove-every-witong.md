---
title: Platform labels do not prove every native download exists
author: Witong
date: 2026-10-25
branch: main
id: l-9cd0c6ac
scope: repo
status: active
src: agent
touches:
  - ".github/assets/banner-fr.png"
  - ".github/assets/banner.png"
  - ".github/assets/icon.png"
  - README.fr.md
  - README.md
  - THIRD_PARTY_NOTICES.md
  - assets/astra-icon.png
  - assets/astra-logo-three-branches-starry-v1.png
  - biome.json
  - bun.lock
---

## Decided
Cue: the user noticed that getastra offered Windows and both Linux packages but no Mac DMG. Release checks must cover each advertised native archive in both localized UI links and packager output, not only the list of supported platforms. Keep the Mac DMG alongside the ZIP used by install.sh.
Evidence: one bounded local guidance replay used this Codex session, Bun, the same isolated old page and a 1000 ms budget. The previous three-download check accepted the page without a Mac button; the candidate four-download check rejected it and accepted the repaired build. Existing arrow-free copy checks stayed green. tests/marketing.test.ts now checks the Mac label, control and versioned URL; tests/package.test.ts creates, mounts and verifies the signed DMG and installer ZIP. This supports this specific release check; transfer to another task remains unverified.

## Tried and ruled out
Adding macOS to the platform string was insufficient: it already appeared while its manual download was missing. Linking a DMG before implementing scripts/package-macos.ts would only create a broken release URL. Reusing the installed older app under the new version would mislabel the release.

## Watch out
The public Site and GitHub release audience remain separate decisions. Build candidate archives separately from /Applications/Astra.app, retain existing versioned outputs, and exclude dist/client, dist/server and dist/website from the Mac bundle because those web outputs may target a personal host. A valid signature alone cannot prove that the packaged renderer and main process speak the same IPC generation; verify their actual snapshot call with an isolated profile and fake Codex account before activation.
