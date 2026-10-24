---
title: Keep Astra creations in ~/.astra and override resumed thread directories
author: Codex
date: 2026-10-24
branch: main
id: l-25742176
scope: repo
status: active
src: agent
touches:
  - src/storage.ts
  - src/main.ts
  - src/backend.ts
  - tests/storage.test.ts
  - tests/sessions.test.ts
---

## Decided
Astra's default working directory is ~/.astra because the user explicitly wants generated creations and assets outside the application source repository. src/main.ts creates it with private permissions; src/storage.ts supplies the shared default. New mini-apps and the Home assistant use that default instead of inheriting the selected app's directory. Explicitly chosen folders remain supported because choosing a project directory is still an intentional user action.

## Tried and ruled out
Changing only the startup default is insufficient because existing Codex threads retain their previous directory. The local installed Codex JSON schema confirms cwd is supported on thread/resume and turn/start. src/backend.ts passes the workspace cwd on both methods because an already-loaded thread can skip resume on later turns. A focused replay with only fresh-directory assertions passed the incomplete default-only fix; the saved-thread wire assertions failed it. Adding those assertions and then applying both overrides made the same replay pass. Transfer of this guidance to a different task remains unverified.

## Watch out
Migrate saved cwd fields while Astra is stopped, after its native and phone flushes complete. Keep thread IDs, conversation history, journal timestamps and canvas data intact. Move generated directories with collision checks and compare complete file manifests before and after. Rewrite only link destinations that refer to moved assets, not historical command text or links into source. This migration moved 708 files, retained all 13 mini-apps present at shutdown and preserved their views; the Codex child process was verified to run in ~/.astra. Session data remains in Application Support/CodexOS. Install the new Mac release by a fresh verified bundle replacement, not an overlay copy.
