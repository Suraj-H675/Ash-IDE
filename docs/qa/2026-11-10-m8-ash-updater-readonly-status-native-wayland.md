# M8 — truthful Ash updater status, native Arch Wayland

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline:** validated `main` `e903791a218cbdbfa354a6f421384d3f970d5c66`.
**Feature:** `feat/m8-safe-ash-updater-status`; code commit `c65aa1b9670990d6f0207d6167e2084716bd9f54`.
**Classification:** verified read-only updater status and unavailable UX, **not** a functioning production updater or accepted M2/M8.

## Safety and approved scope

Approved D-003/D-023 and source pack 13 require an Ash-only release feed, verified artifact authenticity, safe preservation of running PTYs/agents, compatible state migration and rollback. If an Ash release/update pipeline is unavailable, Ash must **show truthful unavailability**, never use an Orca feed or offer unimplemented installation.

Prior boot requested unregistered `updater:getStatus`; the inherited Settings page displayed Check/Download/Install and Orca release/channel controls even though Ash Main registered none of those actions. This feature registers **only** trusted-main-renderer `updater:getStatus` and `updater:getVersion` at startup. The status is `{state:'unavailable',reason:'source-build'}` for source builds or `{state:'unavailable',reason:'not-configured'}` for an unconfigured packaged Ash build. Version comes from Electron `app.getVersion()`. Foreign/stale webContents are denied on each invoke; no check/download/install/release-picker IPC or automatic updater setup is added.

Renderer default status is unavailable to avoid a first-frame actionable update button. General Settings renders Ash-only manual-release guidance and a version, omitting unavailable check/download/install/channel/delay/remote-update controls. Status comparison, status-card visibility and stale nudge/changelog clearing explicitly support unavailable states. The inherited broad updater code, source/locale assets and other legacy update UI paths are not removed by this slice.

## Source checks

- Direct Node Vitest forks **4/4 PASS** across a real read-only updater IPC test, actual React Settings UI for both unavailable reasons, and existing persistent duplicate-terminal repair startup test.
- TypeScript (node/renderer), Oxfmt, native and type-aware Oxlint with warnings denied: **PASS**.
- Electron **source** desktop bundle and sandbox preload: **PASS**. Historical ineffective dynamic-import warnings remain.
- Provenance **PASS**: 33,506 pinned upstream source files, 254 adapted Ash file hashes, 8,260 removals, unchanged source MIT license digest.
- CI foundation workflow now includes both new tests in the hosted Node-forks steps.

## Native Wayland evidence, exact code commit

A real Electron source app launched on Arch Linux/Hyprland native Wayland with a fresh isolated private profile at `/tmp/ash-gui-ready-qa-PgOP4W/`: private HOME/XDG dirs, Ash userData, browser state, CODEX_HOME and CLAUDE_CONFIG_DIR. No ordinary user repository, credentials, SSH config, foreign hooks or app state were loaded/changed.

The visible mapped `ash-ide` window titled *Ash IDE*, first-window service barrier, persistent local runtime pointer, renderer reload, console/stderr/CDP capture and all **23/23 assertions passed**. Actual Electron `ipcMain` had **550** handlers vs 548 previously, including **exactly two** updater channels (`getStatus`, `getVersion`). Real preload invokes returned unavailable/source-build and version `0.1.0`, exactly matching Electron's version; no mutating updater IPC was registered. Other verified GitHub PR, provider-usage and disposable repo `.agents/skills/ash-qa-fixture/SKILL.md` discovery checks continued to pass.

Compared with previous validated native baseline `e903791a` (`/tmp/ash-gui-ready-qa-FWnmfI/`), distinct missing startup IPC names decreased **1 → 0**, removing only `updater:getStatus` and adding none. The test profile's terminal daemon and local runtime stopped through scoped commands (both exit 0), with no remaining profile-owned processes. Full events, screenshot and results remain private, not committed.

## Open acceptance

This is truthful read-only availability reporting, **not** a production updater, installed AppImage, verified release artifacts, rollback or safe-session installation. Non-startup legacy Orca update/settings/remote-development/plugin paths and branding, full M8 removal, real authenticated provider turns, trusted root SessionStart correlation, packaged Wayland/X11 and Windows/macOS remain **OPEN**.

Exact-tip feature CI, deliberate fast-forward integration, post-integration tests, and exact `main` hosted CI are separate acceptance gates.
