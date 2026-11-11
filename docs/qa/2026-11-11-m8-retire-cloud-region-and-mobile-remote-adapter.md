# M8 — retire vendor relay HTTP/region dependencies and phone remote-host proxy

**Date:** 2026-11-11 (Asia/Kolkata).

**Feature branch:** `feat/m8-retire-cloud-region-and-mobile-remote-adapter`, based on accepted `main` `e757834659b38fa7b5d37bd90015f165ba1cc156`.

**Classification:** Scoped M8 source removal and secure compatibility adaptation, **not** complete M8, packaged AppImage acceptance or release approval.

## Implementation and provenance

- Removed **eight pinned Orca vendor relay modules** in `src/main/runtime/mobile-cloud-relay/`: HTTP director requests, assignment-rate gate, region catalog fetch, correction protocol, region selection, cached preference handling, probe/event logging and latency probing. The preceding milestone had already deleted their only real vendor session/control consumers.
- Removed the **phone-to-remote-environment host adapter** `src/main/ipc/runtime-environments/runtime-environment-mobile-relay-hosts.ts`. It had no registered caller after the prior mobile relay-provider retirement, but its legacy retirement function was still invoked by generic runtime-environment invalidation.
- Removed **only** that unused phone-relay retirement import/callback from `runtime-environments.ts`. Retained authenticated browser client-host retirement, closing all runtime-environment subscriptions, generation fencing, desktop browser-bridge cleanup and status recovery.
- The still-present legacy push gateway session used a single pure fingerprint utility from the relay HTTP client. Preserved its exact `sha256(publicKey).base64url.slice(0,16)` behavior inside `push-gateway-session.ts`, without importing or starting vendor relay HTTP infrastructure. The push gateway itself is excluded product code awaiting a separately bounded review; this milestone does **not** claim it has been removed.
- Legacy profile cloud sign-out no longer calls the now-deleted relay-region cache clearer. This deliberately leaves old cache files on disk instead of silently deleting historical data. It does **not** make legacy cloud login or subscriptions an approved Ash feature.
- Preserved `RelayRevokeOutbox`, historical device records and `simulated-mobile-e2ee-v2-peer.ts` for verified local-browser E2EE tests. No existing user repository, external application's profile, connected account, user device record, credential or other personal data was modified or migrated.
- Updated `ash-retired-vendor-relay-session.test.ts` with negative file/phone-proxy assertions, positive browser-host retirement and historical outbox assertions, profile cache preservation check, and a real `PushGatewaySession` constructor fingerprint compatibility check. Its existing GitHub foundation CI registration remains.
- Added **nine exact pinned original source SHA-256 entries** to `docs/provenance/ash-exclusions.json`, without changing the order or values of existing entries; maintained independent Ash Git history and the original MIT license notice.

## Observed local evidence

- Focused vendor-source exclusion, fingerprint compatibility, historical outbox, local pairing and previously retired phone relay tests: **16/16 PASS across 5 suites**.
- Expanded authenticated local browser, device-key and WebSocket security, PTY/terminal overlays, original-folder agent launch/replay, legacy device revocation, sidebar, headless Orcad and renderer/preload exclusion matrix: **239/239 PASS across 31 suites**. The inherited agent-launch fixture still writes nonfatal optional mobile tab-selection warnings; none of the tests failed.
- Full TypeScript projects, Oxfmt and native/type-aware Oxlint with `--deny-warnings`: **PASS**, zero lint warnings/errors.
- Pinned Orca provenance: **PASS**, 33,506 upstream file records; 354 currently adapted Ash source hashes; **8,378 explicitly documented exclusions**; MIT SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.
- Guarded Electron production source build: **PASS**, plain Node daemon-entry and sandbox preload verification passed. Renderer graph 255 chunks / 7,836.4 KB minified, with inherited ineffective dynamic-import warnings.
- Native Linux Wayland Electron source-app launch using isolated private profile `/tmp/ash-m8-cloud-region-wayland-AJMtcC`: **PASS**. Actual Ash IDE renderer DOM complete, preload active, `pty.spawn`, `nativeChat`, `settings` available; `mobile`, `speech`, `automations` preload keys absent. HOME/XDG/Codex/Claude/GH/Git global configuration redirected to test profile. Test Electron and three matching helpers stopped.
- GitHub feature-tip CI and independent post-integration `main` CI are **separate required acceptance gates**. Report their success only after verifying the exact hosted SHA.

## Remaining M8 and workflow

Dormant push gateway/client/notification source, legacy cloud-profile service and account modules, other managed-remote runtime/SSH code, mobile translation strings and excluded bundled assets remain separate reachability audits. Do not delete local browser E2EE, provider-native flows, Git-over-SSH, Chromium extensions, native PTY, or the optional local emulator because nearby symbols mention mobile/relay/SSH.

Packaged AppImage process/listener inspection, X11, Windows/macOS, real provider-authenticated end-to-end execution and full M8 remain **open**. The guarded source build and real Wayland app launch do not replace packaged verification.

Reused `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward` on a new feature branch from the clean validated tip. No new worktree, force push, unrelated cleanup, or destructive Git operation. Canonical `main` stays at its last accepted state until exact feature CI succeeds.
