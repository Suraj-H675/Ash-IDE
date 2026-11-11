# M8 — retire unreachable vendor relay session and control implementation

**Date:** 2026-11-11 (Asia/Kolkata).

**Feature branch:** `feat/m8-retire-orphan-cloud-relay-session-control` based on accepted `main` `c030750d60db35c34ce08fa387f2ba628c7c131f`.

**Scope:** A bounded vertical removal of unused Orca vendor relay code. This is **not** all of M8, full vendor/cloud removal, or a packaged-release acceptance.

## Implementation and retention decisions

- Deleted **27 pinned Orca-derived files** from `src/main/runtime/mobile-cloud-relay` that formed an orphaned relay auth/session broker, control WebSocket client, origin pool, host proof, session-demand, assignment retry, renewal, readiness and unused region refresh/helper pipeline. The code had no external production or test import. Remaining modules do not depend on the removed files.
- Preserved **10 still-needed or support modules**: `relay-revoke-outbox.ts` for historical device revocation persistence; `simulated-mobile-e2ee-v2-peer.ts` for existing local E2EE authentication tests; `relay-http-client.ts` and its dependencies used by the still-present push fingerprint helper; and `relay-region-preference.ts` and its dependencies used by legacy profile sign-out. The retained `relay-http-client.ts` still contains vendor-relay network routines. Do **not** claim all cloud code has left the source tree or packaged assets.
- Added `ash-retired-vendor-relay-session.test.ts` to assert the exact deleted/retained module inventory and retain positive tests for durable historical outbox reload/idempotency and the old fingerprint algorithm. Registered the test in the retained IPC foundation CI job.
- Added 27 deletion records with their exact pinned Orca source SHA-256 values to `docs/provenance/ash-exclusions.json`. The old exclusion entries and original MIT license notice are preserved; no forced Git history rewrite.
- No existing user device registry, provider account, browser profile, external application storage, personal configuration or repository was changed. Isolated test directories were created only under `/tmp`.

## Actual local verification

- Focused source exclusion, historical outbox, local pairing and previously removed phone-relay regressions: **13/13 PASS across 4 suites**.
- Expanded E2EE local browser/device-key authentication, historical phone revocation, mobile-scope rejection, terminal streaming and overlay, agent launch/replay, sidebar, headless Orcad and preload/renderer gates: **236/236 PASS across 30 suites**.
- Full TypeScript projects, Oxfmt, native Oxlint and type-aware Oxlint (`--deny-warnings`): **PASS**, no lint warnings/errors.
- Pinned Orca provenance: **PASS**; 33,506 upstream records, 351 Ash adapted source hashes, **8,369 explicitly documented removals**, original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.
- Guarded production Electron source build: **PASS**, plain-Node daemon entry and sandbox preload checks pass. Renderer graph 255 chunks, 7,836.4 KB minified. Existing ineffective dynamic-import warnings remain.
- Actual Linux Wayland source-app startup with isolated disposable profile `/tmp/ash-m8-orphan-cloud-relay-wayland-6CkZkP`: **PASS**, complete Ash IDE renderer, preload active, local `pty.spawn`, `nativeChat`, `settings` present and excluded `mobile`, `automations`, `speech` preload APIs absent. HOME/XDG/Git/Codex/Claude/GH settings were redirected; test-owned Electron and three profile-matched helpers were stopped.
- Feature-tip and post-integration `main` GitHub CI are separate gates. Their exact SHA/results must be verified before milestone acceptance.

## Remaining gates and workflow

The still-imported profile-cloud-service, push-gateway-session and mobile-cloud relay helpers, remote-environment adapter, mobile translation assets, other excluded sources, and packaged bundle/process listener audits remain separate M8 work. Local browser E2EE, native PTYs, optional emulator, provider-native integration and historical credential cleanup must survive future removals. Full AppImage packaged execution, X11, Windows/macOS, real provider E2E and full M8 acceptance are not claimed.

Reused `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward`, without creating a new worktree or changing other branches. Canonical `main` remains the prior accepted commit until feature-tip CI succeeds; integrate only with a guarded fast-forward and normal push.
