# M8 — retire mobile pairing IPC, preload bridge, relay offer minting and legacy tests

**Date:** 2026-11-11 (Asia/Kolkata)

**Branch:** `feat/m8-retire-mobile-pairing-entrypoints`, based on the accepted `main` commit `d9fb329dca2593d015f98f25db550814eb4f1f32`.

**Classification:** Scoped M8 production-surface removal. Not complete M8, packaged AppImage acceptance, X11 acceptance or release sign-off.

## Source changes

- Deleted `src/main/ipc/mobile.ts`, the unregistered legacy Electron IPC handler for phone QR/mobile pairing, remote network exposure, mobile device administration and firewall/relay controls.
- Deleted `src/preload/api/mobile-bridge.ts`, an unused mobile preload API definition. It was already omitted from Ash's active preload and rendered API.
- Deleted the `RuntimeRpcMobilePairing` class and mobile QR/relay-offer creation pipeline. `RuntimeRpcShutdown` now derives directly from `RuntimeRpcPairing`. Removed its pending offer queue, generation/in-flight state, installer hook and unused mobile-offer type. Mobile relay-provider cleanup state used elsewhere is **not** removed in this slice.
- The surviving generic `createPairingOffer` fails closed when `scope: 'mobile'` is supplied, with `mobile_pairing_disabled` before checking transport availability, creating a device, rotating a pending credential or mutating a registry. The supported runtime-scoped local browser offer path is retained.
- Updated the real WebSocket/bind recovery tests to test explicit rebind transport mechanics without minting phone offers; added a positive assertion that local-browser pairing does **not** widen its loopback listener.
- Reworked the real historical-mobile WebSocket rejection and persisted-device revocation tests to insert an isolated legacy device directly into their test-only registries, **not** generate new mobile pairing offers. The tests continue to verify mobile credentials cannot authenticate and old rows can be revoked without affecting runtime clients.
- Retired three legacy Orca-only test files covering vendor relay provisioning, on-demand relay installer and mobile pairing-mode persistence, since those behaviors are excluded by Ash. They are not counted as passing tests. Replaced their product-boundary checks with `ash-mobile-pairing-entrypoints-retirement.test.ts` and registered it in GitHub foundation CI. Other retained device-registry, runtime browser, WS recovery and credential-revocation tests continue to run.
- Added six deleted upstream-derived paths with exact pinned Orca source hashes to the source-exclusion ledger. No existing user profile, stored device row, provider account, separate application data, credentials or repository was edited or migrated.

## Actual verification

- Real pairing, revocation, websocket-bind and negative mobile-auth tests, including source-exclusion tests: **42/42 PASS in 5 suites**.
- Expanded E2EE/local browser and device-key authentication, PTY stream, workspace/agent launch/replay, revocation, local-only Orcad, native preload and renderer exclusion suites: **200/200 PASS in 22 suites**.
- Full TypeScript project check, Oxfmt, native/type-aware Oxlint with `--deny-warnings`: **PASS** with zero lint warnings/errors.
- Guarded Electron source build, daemon-entry plain-Node and sandbox preload checks: **PASS**; 255 renderer chunks / 7,836.4 KB minified. Inherited ineffective dynamic-import bundler warnings remain.
- Source provenance verification: **PASS**; 33,506 pinned Orca source records, 357 current Ash source adaptations, 8,282 documented removals, unchanged original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Native Linux Wayland Electron source-app smoke with disposable profile `/tmp/ash-m8-no-mobile-pairing-wayland-oidrr8`: **PASS**. Actual renderer title `Ash IDE`, DOM complete and preload present; mobile/automations/speech preload APIs absent; local `pty.spawn`, `nativeChat` and `settings` available. HOME/XDG/Codex/Claude/GH/Git global config were isolated; test Electron and three matching helpers were stopped.
- Feature-tip and integrated-main GitHub CI are **separate required acceptance gates**; record success only after checking the exact hosted SHA.

## Remaining exclusions and verification

This slice removes phone pairing **creation and UI bridge**; it deliberately preserves old device registry rows, E2EE support, local browser device-key admission, native PTY, existing revocation logic and other methods that safely handle historical credentials. The generic internal `createPairingOffer` is still used for runtime-scoped browser clients; it is **not** a mobile offer. Earlier code for relay-provider callbacks, network exposure, unused pairing server methods, mobile-focused types, legacy renderer components and other excluded systems is not fully retired. This milestone does not claim all mobile or remote code has been purged from packaged assets.

Packaged AppImage/standalone daemon listener, X11, macOS/Windows, native provider-authenticated agent sessions and full M8 source/bundle exclusion remain open.

## Git/worktree isolation

Reused the **same clean** worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward` on this dedicated feature branch. No new worktree was created, no other branch/history was rewritten, and canonical `main` remains the validated integration checkout until feature CI passes.
