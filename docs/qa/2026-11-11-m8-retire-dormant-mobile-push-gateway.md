# M8 — retire the unused vendor mobile push gateway

**Date:** 2026-11-11 (Asia/Kolkata).

**Feature branch:** `feat/m8-retire-dormant-push-gateway`, based on accepted `main` `804f702db1e84e960d3593b2a5faa69ad071e5c6`.

**Classification:** Scoped M8 source and command-surface removal, not full M8 or packaged AppImage/release acceptance.

## Source removal and retained behavior

- Deleted **13 pinned Orca-derived root push files** in `src/main/runtime/push/`: `desktop-push-service.ts`, gateway dispatcher/client/session/origin/response, gateway host-challenge/proof and its inherited test vector/fixture, gateway result counters and registration throttle. The gateway had no active production constructor/startup route after earlier M8 mobile/pairing/relay retirement; its only remaining external gateway origin reference was an unused `getOrcaPushGatewayUrl` accessor in the legacy cloud profile configuration.
- Removed that dead `getOrcaPushGatewayUrl` accessor and import; left other legacy cloud profile authentication unchanged for later dependency review.
- Removed the now-unreachable `MobilePushRegistrar` interface and four registration/test/unregistration methods from `RuntimeMobileNotificationController` and its command-surface installation. These push service methods were not effective Ash RPC methods and had no surviving production caller. Existing `notifications.registerPush`, `notifications.testPush`, and `notifications.unregisterPush` remain rejected by the real dispatcher.
- **Preserved** `src/main/runtime/push/notifications/`, including desktop notification fan-out, epoch-scoped replay, dismissal tracking, desktop presence, terminal and workspace notification mute. Preserved the local desktop `notifications.subscribe`, `notifications.unsubscribe`, `notifications.getMissedSince` and `notifications.reportDesktopPresence` RPC methods. No bundled mobile push gateway is instantiated, called or implicitly activated.
- **Preserved** `PushUnregisterOutbox` and persisted historical phone/relay registration schemas for non-destructive device-record cleanup. New push delivery and remote token-deletion processing are **not** implemented: a queued historical unregister record is durable local bookkeeping, not evidence that a remote vendor was contacted or a token was revoked.
- Updated the previously accepted orphan-vendor-relay test to stop importing the now-deleted `PushGatewaySession`, whose fingerprint compatibility test is no longer relevant to a retained product. New `ash-mobile-push-gateway-retirement.test.ts` checks the exact deleted source inventory, absence of cloud accessor and runtime registration hooks, real desktop notification fan-out/epoch replay/unsubscription, and durability of an existing historical push-unregister record. Registered the new suite in GitHub foundation CI.
- Added **13** upstream-file exclusions with their original pinned Orca source SHA-256 values; source provenance and the original Orca MIT license remain intact. No existing user repository, profile, credential, notification record, provider account or another application's data was changed or migrated. Disposable test roots were used.

## Observed local acceptance

- Focused gateway, notifier, runtime RPC, historical revocation and previous relay exclusions: **20/20 PASS across 4 suites**.
- Expanded E2EE local browser and device-key authentication, WebSocket bind/recovery, native terminal/PTY streaming and overlays, agent launch/replay, notifications RPC refusal, historical credential revocation, headless Orcad, renderer/preload startup gates: **244/244 PASS across 32 suites**.
- Full TypeScript projects, Oxfmt, native Oxlint and type-aware Oxlint with `--deny-warnings`: **PASS** with zero lint warnings/errors.
- Source provenance: **PASS**, 33,506 pinned Orca source records, 356 currently modified Ash source hashes, **8,391 documented exclusions**, unmodified original Orca MIT SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded Electron production source build: **PASS**, daemon-entry plain-Node and sandbox preload guards; renderer boot graph 255 chunks / 7,836.4 KB minified. Inherited ineffective dynamic-import bundler warnings remain.
- Real Linux Wayland source-app Electron launch using isolated profile `/tmp/ash-m8-no-mobile-push-wayland-oxM3so`: **PASS**. Actual Ash IDE DOM complete, preload present, `pty.spawn`, `nativeChat`, `settings` available, excluded `mobile`, `automations` and `speech` preload keys absent. HOME/XDG/Codex/Claude/GH/Git global configuration redirected; test Electron and three profile-matched helpers stopped. This is a source-app GUI/preload check, **not** proof of native OS notification delivery in a packaged app.
- Feature-tip GitHub CI and independent post-integration `main` CI are **separate required gates**. Their exact head SHA/result must be observed before accepting the milestone.

## Remaining M8 work and engineering workflow

Dormant legacy cloud-profile account sign-in/subscription modules, mobile/remote-specific source and localization entries, remaining historical schema compatibility and packaged asset/network exposure audit remain. Do not mistake retained desktop notification, local browser E2EE, Chromium extensions, native PTYs or local emulator modules for excluded mobile-app functionality.

Packaged AppImage execution, standalone daemon/listener/process-tree inspection, X11, Windows/macOS, native provider-authenticated E2E and full M8 acceptance remain open.

Reused the clean worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward` on a dedicated feature branch. No new worktree, competing repository, forced history change, unrelated file cleanup or destructive migration. The canonical `main` checkout remains at its prior accepted tip until feature CI passes.
