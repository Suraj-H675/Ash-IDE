# M8 — remove mobile push RPC and dormant desktop gateway startup

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-exclude-mobile-push-rpc`, based on validated `main` `fd3860d26ce3a87d692e6c901898c729fa91855e`.

**Scope:** Incremental EX-01 / D-005 / D-006 exclusion. This is not full M8 acceptance or a packaged release test.

## Implemented boundary

- Removed `notifications.registerPush`, `notifications.testPush`, and `notifications.unregisterPush` definitions from the **source** `NOTIFICATION_METHODS` manifest. They are therefore absent from both the inherited `ALL_RPC_METHODS` and the filtered active `ASH_RPC_METHODS`. Ash's explicit unavailable-RPC list also names all three so accidental later reintroduction remains filtered.
- Updated the generated RPC parameter catalog using the repository generator, removing the three retired method entries. Historical mobile schemas, data and pairing records remain untouched.
- Removed the unreferenced desktop `main-process-push-startup.ts` helper and its `desktopPushService` state/quit hook. The preceding M8 slice already removed the actual headless Orcad `DesktopPushService` startup. This slice makes the desktop startup graph free of the unused push gateway launch path, but does not remove every historical push implementation module.
- Preserved `notifications.subscribe`, `notifications.unsubscribe`, `notifications.getMissedSince` and `notifications.reportDesktopPresence` for **local** notifications, as well as local authenticated RPC, PTY, agents, browser extensions and user-directed orchestration Runs. No push registration or vendor unregister request was sent during this source-level change.
- Recorded the deliberately deleted upstream-derived startup file in `ash-exclusions.json` using its exact pinned source hash `c70538c5916a325526349051611a87f5bfd16eb9669e57de98921e23465648fc` rather than bypassing source-provenance verification.

## Actual verification

- Offline frozen-lockfile dependency install: **PASS**.
- Focused RPC, owner-versus-paired dispatcher, local notification replay, preferences and exclusion suites: **22/22 PASS** across five files. Tests directly assert `method_not_found` in the real default dispatcher and the absence of all three methods in both RPC manifests.
- Expanded regressions, including local-only Orcad, retained manual Run/worker recovery, and excluded mobile automations: **58/58 PASS** across nine files.
- Full project TypeScript check: **PASS**, after correcting a narrow inferred `Set` type in the added test. Targeted Oxfmt, native Oxlint and type-aware Oxlint with denied warnings: **PASS, zero warnings/errors**.
- Generated RPC parameter catalog check: **PASS**.
- Source provenance: **PASS**, 33,506 pinned Orca files, 332 current Ash source adaptations, 8,268 explicitly documented exclusions, unchanged pinned MIT license hash `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded Electron source build: **PASS**; sandbox preload verification and built plain-Node daemon entry checks passed. Renderer graph: 255 chunks / 7,836.4 KB minified. Existing ineffective dynamic-import warnings remain.
- Native Linux/Wayland Electron desktop smoke with private test profile `/tmp/ash-m8-no-push-wayland-2IDz4g/`: **PASS**. Through an ephemeral localhost Chromium debugging port, inspected the real renderer: title `Ash IDE`, `document.readyState=complete`, preload present; `window.api.mobile`, `automations`, and `speech` **absent**; `pty.spawn`, `nativeChat`, and `settings` **present**. HOME/XDG/Codex/Claude/GitHub CLI/Git global settings were pointed at the disposable profile. The test process and its three profile-matched helper processes were stopped.

## Open acceptance work

The legacy `MobileSocketWiring`, paired-device registry, mobile/relay transport implementation and saved device records remain in source and require a **separate reachability and safe-removal review** so retained localhost clients are not broken. Notification replay still exposes legacy `deliveredPushes` compatibility parsing; this does not register the retired methods. The desktop-only AppImage and standalone headless Orcad distribution need actual packaged-bundle inspection and listener/process-tree evidence. No Windows or macOS native acceptance, live provider authentication, or complete M8 exclusion has been claimed. Feature-tip and integrated-main GitHub CI remain separate approval gates.
