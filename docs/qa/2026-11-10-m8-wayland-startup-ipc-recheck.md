# M8 — native Arch Wayland renderer startup IPC audit and UNC recovery gate

**Date:** 2026-11-10 (Asia/Kolkata)
**Baseline source:** `main` at `4f2e026506055a4c7ba0ea9d0a9512bc006cbf44`.
**Environment:** Arch Linux 7.2.11-arch1-1, Hyprland 0.57.0, native Wayland, Electron 43.8.6, development **source desktop bundle** (not AppImage or release).
**Scope:** Renderer startup IPC error inventory, exact M8 exclusion regression, Windows-only drive-UNC renderer recovery. Not M2 authenticated agent acceptance or packaged application acceptance.

## Isolated native test

The native Playwright Electron test ran the built source app in a fresh `/tmp/ash-gui-ready-qa-CCY3TU/` root with private HOME, XDG config/cache/data/state, `ASH_DEV_USER_DATA_PATH`, `ASH_USER_DATA_PATH`, `ORCA_USER_DATA_PATH`, CODEX_HOME and CLAUDE_CONFIG_DIR. No provider credentials, user repositories, user browser profiles, account state or foreign hooks were loaded or modified. Test root and subdirectories were `0700`.

The test waited for `window.api.app.awaitFirstWindowStartupServices()`, verified 535 Main IPC handlers and the isolated runtime pointer, explicitly revealed the first window, and **reloaded the renderer only after the startup barrier** while Electron stderr, Playwright console/page errors and CDP log were being captured. The initial unguarded reload diagnostic was discarded as a harness race after Electron reported `ERR_ABORTED`; no acceptance claims are based on it.

The corrected run observed a fully loaded Ash IDE document, one visible Hyprland-mapped native `ash-ide` window titled *Ash IDE*, Linux preload platform, and absence of the mobile and app-managed Skills sidebar entries. **8/8 targeted assertions passed.** No missing-handler errors were emitted for `skills:bundledPlan`, `mobile:listDevices`, or `wslMove:listPendingRendererRewrites` in the instrumented startup and reload. The isolated `terminal-daemon stop --yes --json` returned `status=stopped`, `killedCount=0`; scoped `runtime stop --yes --json` returned `status=stopping` and `mode=graceful`. No processes referring to this disposable root remained. Screenshot, event log and report stay in that **private test directory**, not committed to Git.

## Unresolved startup IPC mismatches

This is **not** clean-console acceptance. The same baseline run recorded 24 other distinct missing-handler names:

| Category | Observed handlers (not registered in this Ash startup) |
| --- | --- |
| Windows-only migration | `wslDriveUnc:listPendingRendererRewrites` |
| Removed/cloud/paired-app surfaces | `automations:rendererReady`, `mobile:consumePendingUnpairedDeviceAuthFailure`, `orcaProfiles:list`, `orcaProfiles:authStatus`, `orcaProfiles:signInProgress`, `jira:status`, `linear:status` |
| General app plugin surfaces | `plugins:getAutoUpdateState`, `plugins:list`, `plugins:listIconThemes`, `plugins:listLanguagePacks`, `plugins:listTerminalThemes`, `plugins:listThemes`, `plugins:statusBarState`, `plugins:takeUpdateReviewNotices` |
| Requires retained-versus-excluded classification | `gh:checkOrcaStarred`, `gh:reportVisiblePRRefreshCandidates`, `rateLimits:get`, `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`, `updater:getVersion` |

The presence of a name in this inventory does **not** authorize re-registering excluded functionality. Provider-native skill discovery and ordinary Git SSH must remain; generic Ash/Orca app skill marketplaces, remote-development, paired mobile and scheduled automation surfaces are excluded. Retained source-control, provider usage/status and desktop update behavior require deliberate feature-by-feature classification before changes. The banner text still includes inherited **ORCA** branding in the baseline renderer, which remains a separate visual/identity cleanup item.

## Follow-up in this feature branch

The `runWslDriveUncRendererStoreRewrites` production entry point now checks the actual trusted preload platform and returns before invoking the Windows-only handler on Linux/macOS. On Windows (`win32`) it preserves the migration query and existing recovery. No handler was invented and no Windows/WSL conversion data was modified. The existing desktop startup-gates test now asserts this behavior on Linux, macOS and Windows.

**Local pre-integration evidence:** Node Vitest forks **6/6 PASS**, TypeScript project check **PASS**, Oxfmt **PASS**, native and type-aware Oxlint with warnings denied **PASS**. Electron source desktop bundle **PASS** (existing chunk warnings; sandbox preload verified). Source provenance ledger updated (33,506 upstream records, 229 adaptations, 8,260 documented removals, unchanged MIT license hash). Hosted CI and post-integration verification remain separate gates before final acceptance.

## Exact feature-commit native rerun

Built and ran source commit `8e1d32323f107390552eee0f61b482cc8ca691d8` under a **new**, independently isolated `/tmp/ash-gui-ready-qa-sttvSl/` root (not the baseline profile). The native Wayland app again passed **8/8 assertions**: 535 registered Main handlers, completed first-window startup barrier and runtime pointer, successful renderer reload, mapped `ash-ide` Hyprland window, and absent mobile/managed-skills navigation. Console/Electron-stderr checks now included **all four** targeted names: `skills:bundledPlan`, `mobile:listDevices`, `wslMove:listPendingRendererRewrites` and `wslDriveUnc:listPendingRendererRewrites`. None occurred. Unrelated missing-handler names decreased from **24 distinct baseline names to 23**, with exactly `wslDriveUnc:listPendingRendererRewrites` removed and no new names. The scoped terminal-daemon and runtime stop commands both exited successfully; no process referring to this test profile remained. Feature screenshots and logs remain only in its private test root.

**Verdict:** Original three unsupported startup calls and the Windows-drive UNC Linux startup call are **verified absent on real Wayland**. Windows native UNC migration success has **not** been directly tested (only unit-level Windows dispatch preservation). Full clean-console startup, M8 removals, Wayland/X11 packaged releases, authenticated provider turns, and M2 overall: **OPEN**.
