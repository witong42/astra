---
title: Full-history changelogs include local build milestones
author: Witong
date: 2026-10-25
branch: main
id: l-34b9b5d2
scope: repo
status: active
src: agent
touches:
  - package.json
---

## Decided
Cue: the user clarified that the changelog must cover the beginning through now. Reconstruct all recorded product milestones from Git, tags and retained bundle metadata; group unversioned local revisions rather than inventing patch-level attribution.
Evidence: one same-session, same-tools Bun coverage replay with a 1000 ms ceiling rejected a latest-only draft and accepted CHANGELOG.md's 0.1.0 through 0.5.1 history. Both retained the newest-first check. No inference calls; transfer remains unverified.

## Tried and ruled out
Current release notes alone omit the requested history. Git tags alone also omit recorded local Windows, Linux and voice builds.

## Watch out
Historical dates are development milestones, not proof of public GitHub releases.
