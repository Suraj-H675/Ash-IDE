# M8 — retire orphan desktop mobile-cloud relay startup

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-remove-orphan-mobile-cloud-relay-startup`, based on accepted `main` `537fe2d44e6a29fece8db2ade5c4bf4d6011bfea`.

**Scope:** Remove unused mobile vendor-relay desktop startup code and its state/quit wiring. This is a scoped M8 exclusion, not complete mobile, plugin, cloud, or packaging acceptance.

## Implementation

- Deleted the unreferenced desktop mobile-cloud relay launcher, relay-status broadcaster, relay-service installer and desktop relay service. The removed implementation could otherwise launch a vendor relay broker and register a resume callback if a future bootstrap accidentally imported it.
- Removed obsolete `desktopRelayService`, `desktopRelayInstaller`, and `desktopRelayStatus` composition-root slots. Removed before-quit calls to the unused mobile relay service and `setMobileRelayPairingProvider(null)`; kept ordinary agent-awake, rate-limit, daemon and runtime shutdown behavior.
- Updated the existing updater-veto and pending-writer quit regression fixtures without weakening their retained-shutdown assertions.
- Added `ash-excluded-mobile-cloud-relay-startup.test.ts` and registered it, together with the retained updater-veto test, in the foundation GitHub CI suite. These verify that excluded source files and IPC/status hooks remain absent while local runtime and quit entry points remain present.
- Recorded the four upstream-derived removals explicitly in `docs/provenance/ash-exclusions.json` with their exact pinned Orca hashes. No other repositories, user worktrees, pairing/device registry files, vendor accounts or credentials were edited.

## Verification

- Focused mobile-cloud exclusion, retained quit/pending-writer, headless local-only Orcad and live mobile WebSocket rejection: **18/18 PASS across 5 suites**.
- Expanded WebSocket E2EE and device-key authentication, local browser, terminal streaming, device revocation, agent launch/receipt replay, mobile-denial, quit and startup matrix: **96/96 PASS across 18 suites**.
- Full TypeScript project check, changed-TypeScript formatting, native and type-aware Oxlint with `--deny-warnings`: **PASS**, zero warnings/errors.
- Electron production source build, plain-Node daemon-entry guard and sandbox preload verification: **PASS**. Renderer boot graph remained 255 chunks / 7,836.4 KB minified. Inherited ineffective dynamic-import bundler warnings remain.
- Upstream source provenance: **PASS**, 33,506 pinned Orca file records, 346 Ash adapted source hashes, 8,272 explicitly documented removals. Original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.
- Native Linux Wayland Electron source startup with disposable profile `/tmp/ash-m8-no-mobile-cloud-wayland-sT8Mof`: **PASS**. Renderer title `Ash IDE`, DOM complete, preload present, `mobile`, `automations`, and `speech` preload APIs absent; local `pty.spawn`, `nativeChat`, and `settings` retained. HOME/XDG/Codex/Claude/GitHub CLI/Git global config were redirected to private test directories; Electron and three profile-matched helpers were stopped.

## Simpler development Git workflow

The repository contained **41 worktrees occupying approximately 16 GB** before this milestone; one unrelated older worktree, `m8-speech-integration`, had **18 uncommitted entries**. Instead of making a 42nd worktree, we reused the clean, already-integrated `m8-local-ws-no-mobile-forward` worktree and switched it to a new feature branch based on verified `main`. The earlier feature branch and all existing worktrees were preserved, including the dirty one. This avoided a fresh checkout and dependency installation while keeping canonical `main` clean and validated. Separate worktrees remain appropriate if genuinely independent agents write concurrently. Old worktree removal is intentionally **not** performed without separate ownership/dirty-state review and authorization.

## Remaining gates

The remaining legacy mobile pairing methods, device registry/outboxes, relay host/provider setter APIs, other mobile-cloud-relay source modules and unused preload/mobile IPC source still require separate removal audits. This milestone removes the unused desktop mobile relay service's entry path, **not every possible mobile/cloud-related module**. The local browser runtime transport, browser extensions, Git-over-SSH, provider-native functionality, and manual agent Runs are retained. Packaged AppImage/listener process-tree, X11, macOS/Windows, and real provider-authenticated end-to-end acceptance are outstanding. Feature-tip and post-integration GitHub CI require separate observed success.
