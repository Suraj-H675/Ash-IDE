# M8 — retire runtime mobile relay provider and remote-host registration hooks

**Date:** 2026-11-11 (Asia/Kolkata)

**Branch:** `feat/m8-retire-mobile-relay-provider-hooks`, based on accepted `main` `96bbdc556a75905f43181b7163eb302027cd66e5`.

**Classification:** Bounded M8 runtime-surface removal. Not full M8, complete orphan-source deletion, packaged AppImage or cross-platform acceptance.

## Changes and invariant boundaries

- Deleted the unused `RuntimeRpcPairing` API entry points `setMobileRelayPairingProvider`, `setMobileDesktopRelayHosts`, `setMobileRelayBinding`, its internal `listRelayedPhones` and `queueOrRetainRelayDeviceRevoke` helpers. These hooks had no remaining production callers after Ash retired mobile relay startup, pairing-offer minting and WebSocket forwarding.
- Removed the associated live state slots `mobileRelayPairingProvider`, `mobileDesktopRelay`, `mobileRelayHostCatalog` and `detachPairedServerRows`. Removed their server lifecycle and shutdown callbacks, phone-change notifications, and optional relay worker queue notifications.
- Retired the unused `MobileRelayPairingProvider` type, but retained the legacy transport-context type still referenced by dormant relay source. The former implementation of `setMobileDesktopRelayHosts` could create a phone-to-remote-server relay, browser-host routing and an on-demand remote worktree catalog; this path is no longer constructible from Ash's active runtime server.
- **Preserved** persisted device registry schemas, saved pre-Ash phone records, `revokeMobileDevice`, runtime-scoped browser revocation, `RelayRevokeOutbox`, and `PushUnregisterOutbox`. Historical phone revocation still durably queues an existing relay binding before deleting a credential. If that queue write fails, the device row remains for later retry. This is **local durable bookkeeping**, not evidence of remote vendor revocation/delivery; no vendor worker was installed or started.
- Updated the inherited agent-launch settings-work test to retain local host-label projection without instantiating a retired relay catalog. Updated existing mobile dispatch exclusion tests to assert the registration API and live relay instance are absent instead of injecting a fake relay.
- Added `ash-mobile-relay-provider-hooks-retirement.test.ts`: checks absence of hooks, durable old-phone relay cleanup with fresh outbox reload, no deletion on persistence failure, and independent runtime browser revocation. Added the suite to GitHub's retained IPC checks.
- No existing user repository, device registry, credentials, application profile, provider account or external device was edited or migrated by this change. The test fixtures run under new disposable runtime directories.

## Observed verification

- Focused legacy-device cleanup, settings, client dispatch, and revocation regression matrix: **22/22 PASS across 5 suites**. The first run identified a test-only fixture that did not initialize its registry with WebSocket disabled; the fixture was corrected to use a real loopback listener. No source compromise or skipped regression.
- Expanded encrypted local browser and device-key authentication, WebSocket bind/recovery, terminal streaming, agent launch/replay, runtime pairing, old credential revocation, headless Orcad and renderer/preload gates: **206/206 PASS across 24 suites**.
- Full TypeScript projects, Oxfmt, native Oxlint and type-aware Oxlint (`--deny-warnings`): **PASS**, zero warnings/errors.
- Pinned source provenance: **PASS**, 33,506 upstream Orca records; 360 Ash source adaptations; 8,282 documented removals; unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded Electron production source build: **PASS**, plain-Node daemon entry and sandbox preload guard passed. 255 renderer chunks, 7,836.4 KB minified. Inherited ineffective dynamic-import warnings remain.
- Native Linux Wayland Electron source-app smoke using disposable private profile `/tmp/ash-m8-no-mobile-relay-hooks-wayland-HpzovJ`: **PASS**. Actual renderer title `Ash IDE`, DOM complete, preload present, no `mobile`, `automations` or `speech` preload API; `pty.spawn`, `nativeChat`, `settings` retained. HOME/XDG/Codex/Claude/GH/Git global configuration were redirected. Electron and three profile-matched helpers were stopped.
- Feature branch CI and post-integration `main` CI must be observed separately for **this exact SHA**, not inferred from source build results.

## Open items and workflow

Dormant `src/main/runtime/mobile-desktop-relay` modules, old network-widening transport code, legacy mobile renderer settings and pairing components, retained historical-device schemas, inactive cloud relay authorization, and other excluded product source still require a reachability-based removal pass. The signed/local E2EE browser transport and browser extensions are retained. AppImage, packaged standalone daemon/listener inspection, X11, Windows/macOS and real native-provider end-to-end acceptance remain unverified.

Reused `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward`; no new worktree, no deletion of old worktrees, no force pushes, and `main` remains protected by separate feature and post-integration verification gates.
