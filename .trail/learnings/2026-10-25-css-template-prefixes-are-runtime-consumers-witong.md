---
title: CSS template prefixes are runtime consumers
author: Witong
date: 2026-10-25
branch: main
id: l-4cc3dc15
scope: repo
status: active
src: agent
touches:
  - src/web.css
  - src/Astra.tsx
  - src/registry.tsx
---

## Decided
Cue: cleanup's literal-name scan flagged active voice CSS as unused. Trace runtime templates and plugin output before deleting selectors. In src/Astra.tsx, voice-${voice.status} consumes voice-speaking without a literal class name.
Evidence: one isolated replay on unchanged source, same Codex session, Bun tools and 1000 ms budget: the literal scan missed the voice consumer; the template-aware check preserved it and still identified window-controls-space as orphaned. No inference calls. Transfer remains unverified.

## Tried and ruled out
Zero literal matches alone also misclassified generated gap/tone classes in src/registry.tsx and Markdown task-list classes.

## Watch out
Keep build-generated entry points and type-only modules when checking the app graph. Cleanup preserved them.
