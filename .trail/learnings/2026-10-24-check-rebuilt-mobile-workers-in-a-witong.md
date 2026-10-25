---
title: Check rebuilt mobile workers in a fresh Bun process
author: Witong
date: 2026-10-24
branch: main
id: l-37883e83
scope: repo
status: active
src: agent
touches:
  - scripts/build-web.ts
  - src/site-worker.ts
---

## Decided
Publish the phone client from sites/astra, using its .openai/hosting.json and generated dist/server/index.js. The root .openai/hosting.json is a duplicate project pointer, not the configuration used by that checkout. Verify rebuilt workers in a fresh Bun process. Compare git hash-object with the committed blob ID instead of capturing a multi-megabyte git show.

## Tried and ruled out
On Bun 1.4.3, importing the old worker, replacing its file, then importing with a new URL query retained the old module and falsely rejected the rebuilt release. A fresh process read the new release correctly. Capturing the entire worker with execFileSync's default output limit also caused ENOBUFS; blob comparisons avoid that output.

## Watch out
Cue: release validation reports an old version after a successful rebuild. Lesson: use a new process for generated-worker inspection. Evidence: one isolated old/new module replay, unchanged model and Bun tools, zero inference calls, five-second process budget; the query-import baseline returned old, while the fresh-process candidate returned new. Transfer beyond this mobile publication is unverified. Tests rebuild parent dist outputs with test backend URLs, so run the production build afterward and pin its result in the site checkout before publishing.
