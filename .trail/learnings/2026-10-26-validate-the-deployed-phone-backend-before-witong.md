---
title: Validate the deployed phone backend before changing a healthy Mac
author: Witong
date: 2026-10-26
branch: main
id: l-55be4004
scope: repo
status: active
src: agent
touches:
  - src/main.ts
  - tests/main-voice.test.ts
---

## Decided
A phone connection regression on 2026-10-26 came from the published client artifact, not the Mac server. The deployed HTML was still 0.5.1 build 16 and allowed an unrelated CloudFront origin in connect-src. The real Tailscale route already passed the configured origin and owner checks. Rebuild with the verified private Mac origin after running web tests, pin dist/server/index.js in sites/astra, push that exact source, and publish its matching archive. Fresh-process worker checks and live HTML/JavaScript/font/logo hashes confirmed the 0.6.0 build 20 repair while the owner-only access policy stayed unchanged. A live browser then acknowledged interface commands, loaded rendered mini-app controls, and reported connected WebRTC transport.

## Tried and ruled out
Do not infer Astra's backend from the first HTTPS URL found in a minified bundle. The OpenUI dependency also embeds a CloudFront telemetry default. A broad forbidden-URL search falsely rejected the repaired worker; checking the HTML connect-src and configured bridge origin accepted the repair and rejected the same broken baseline on all four endpoint/release checks. This one bounded replay used the same agent and Bun runtime with no extra inference calls; it establishes this artifact check, not general transfer. Do not reconfigure working Tailscale routes or relax CORS to compensate for a bad client build.

## Watch out
The build-web tests intentionally overwrite generated dist outputs with fixture backend URLs. Always rebuild production afterward, inspect it in a fresh Bun process, and compare live bytes with the artifact being published. The publication checkout is sites/astra and can be stale independently of the main source. A diagnostic event stream receives 429 when a real phone is already active; use acknowledged passive interface status/inspection instead of disconnecting that phone to force a test.
