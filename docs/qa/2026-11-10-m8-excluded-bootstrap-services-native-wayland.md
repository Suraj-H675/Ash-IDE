# M8 — remove excluded bootstrap consumers, native Arch Wayland regression

**Date:** 2026-11-10 (Asia/Kolkata)
**Branch:** `feat/m8-excluded-bootstrap-services`, based on validated `main` `9f4b528bf4377eb3850260a52d934b55f688bfd5`.
**Code commits:** `03984f6d2a492b189f2ca68117435039aac6848a`, `094f329ef34ef678795bac445af9f5662c6acb03`.
**Classification:** Partial early M8 exclusion, not accepted M2 or completed M8. D-005–D-008 and the 03 feature matrix exclude mobile pairing, vendor cloud accounts and scheduled agent runs. Browser automation, manually supervised Runs, terminal agent sessions, provider-native skills/MCP, Git source control and ordinary Git SSH remain retained.

## Changes

- Removed the automatically mounted `useAutomationDispatchEvents` and the app-lifetime automation-change listener. No background scheduling/dispatch IPC registration is restored.
- Removed the unpaired-device-auth notification subscription from the settings/sidebar IPC bridge. Other retained editor-tab, terminal-driver and browser-event bridges were **not** disabled merely because they still contain historical mobile-related names.
- Removed automatic Orca profile list/auth reads at renderer startup, the cloud-profile auth event bridge and the always-mounted Orca Relay unexpected-sign-out promotional card. None of this alters Claude or Codex native provider account selection, directories, credentials or per-session profile pinning.
- Removed the Automations sidebar shortcut plus the dead Automations/Mobile shortcut appearance settings and their search entries. Retired `automations` persisted active views now restore as the terminal, as `mobile` and app-managed `skills` already do. Persisted project/workspace records and historical automation provenance were **not deleted**.

This slice does **not** claim complete vertical removal: archived automation metadata, the legacy Automations page through other explicit entry points, excluded settings surfaces, remote-development and generic app-plugin code remain to audit. No live user profile, repository, sign-in, account, hook setting, or vendor app data was changed.

## Source and tests

- Native and type-aware Oxlint with `--deny-warnings`, Oxfmt, Node/renderer TypeScript and the six-test `ash-excluded-startup-gates.test.tsx` suite: **PASS**.
- Electron source desktop bundle: **PASS**, sandbox preload contract and renderer boot graph verified; existing ineffective-dynamic-import warnings do not establish packaged release quality.
- Provenance: **PASS**, 33,506 pinned upstream records, 237 documented adapted source hashes, 8,260 documented removals and unchanged source MIT license verification.
- The first code commit `03984f6d` completed hosted feature CI successfully. The second code commit `094f329e` passed local validation and exact source build; hosted final-feature-tip CI remains a separate gate.

## Native Wayland observations — code commit 094f329e

A new isolated development profile was created at `/tmp/ash-gui-ready-qa-mvEcHv/` with private HOME, XDG configuration/cache/data/state, Ash userData, Codex home and Claude config. This was a native Arch Linux 7.2.11 / Hyprland 0.57.0 / Electron 43.8.6 **source-bundle** test, not an AppImage or installed-release test. No provider credentials, real user repositories or browser profiles were loaded.

The test waited for the Main first-window startup service barrier (535 registered IPC handlers and an isolated runtime pointer), revealed the real Hyprland-mapped `ash-ide` window titled *Ash IDE*, attached console/stderr/CDP logging, reloaded the renderer and examined the resulting UI. **9/9 assertions passed**, including no excluded Mobile/Skills/Automations sidebar shortcuts. The private test terminal daemon and runtime were both stopped successfully via scoped authenticated CLI commands (exit 0); no test-profile processes remained. Screenshot, console event capture and complete results remain in the private test directory, not Git.

Comparison against the immediately preceding clean-run baseline `/tmp/ash-gui-ready-qa-sttvSl/` on `main` `9f4b528b`:

- **23 distinct missing-handler names before; 17 after.**
- Exactly six disappeared, with no new names: `automations:rendererReady`, `mobile:consumePendingUnpairedDeviceAuthFailure`, `orcaProfiles:list`, `orcaProfiles:authStatus`, `orcaProfiles:signInProgress` and `updater:getVersion`. The latter originated in the removed Orca Relay promotional card, **not** in general update management.
- The four previously addressed errors (`skills:bundledPlan`, `mobile:listDevices`, `wslMove:listPendingRendererRewrites`, `wslDriveUnc:listPendingRendererRewrites`) remain absent.

## Remaining blockers and classification

**17 distinct missing startup-handler names remain**, and their presence is not a request to enable excluded APIs:

- Jira/Linear: `jira:status`, `linear:status` — excluded vendor connectors; remove unwanted startup clients, not provider-git support.
- Broad Orca app plugins: `plugins:getAutoUpdateState`, `plugins:list`, `plugins:listIconThemes`, `plugins:listLanguagePacks`, `plugins:listTerminalThemes`, `plugins:listThemes`, `plugins:statusBarState`, `plugins:takeUpdateReviewNotices` — distinguish from retained browser extensions and provider-native skills/MCP.
- To classify carefully before changes: `gh:checkOrcaStarred`, `gh:reportVisiblePRRefreshCandidates`, `rateLimits:get`, `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, `updater:getStatus`. GitHub source control, normal Git SSH, provider-native skills discovery and configured desktop update checks must not be damaged to make the console green.

The baseline/feature renderer still contains inherited ORCA text and additional excluded settings/UI routes; neither full visual identity nor complete M8 removal is accepted. Real authenticated Claude turns and trusted root SessionStart correlation, persistent-daemon/win/mac packaged E2E and full M2 remain **OPEN**. For this slice only, source-level, native Wayland and the scoped exclusion behavior are verified.
