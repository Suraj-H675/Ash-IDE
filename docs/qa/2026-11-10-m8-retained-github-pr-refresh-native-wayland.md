# M8 retained GitHub PR visibility refresh — native Arch Wayland

**Date:** 2026-11-10 (Asia/Kolkata)
**Branch:** `feat/m8-retained-github-pr-refresh-bootstrap`; based on validated `main` `6e71284cf1c9bab48858dc0b5249b75528df2dd6`.
**Code commit:** `b138f740ee3e8e253ec1dc294fa713d8d5925881`.
**Classification:** Retained GitHub source-control startup/IPC repair, not full M2/M8 or authenticated GitHub-PR acceptance.

## Approved retention boundary

The approved source pack retains GitHub/GitLab PR and CI functionality and normal Git operations; Orca's star marketing, app-managed cloud identities, remote-development, vendor task trackers, and general plugins are excluded. The renderer's `reportVisibleGitHubPRRefreshCandidates` was reaching an unregistered `gh:reportVisiblePRRefreshCandidates` channel even after other excluded startup IPCs had been removed.

This repair registers **only** the already implemented four GitHub PR-refresh Main IPC endpoints (`gh:prForBranch`, `gh:refreshPRNow`, `gh:enqueuePRRefresh`, `gh:reportVisiblePRRefreshCandidates`) through the existing validation/pacing/visibility coordinator, after persistent profile store startup and Main stats observer initialization. Absent stats is a hard initialization error, not a silent skipped registration. No broad `registerGitHubHandlers` call is introduced; `gh:checkOrcaStarred` and `gh:starOrca` stay unregistered.

The existing handler checks candidate repository identity/path against the authoritative saved repository list before scheduling refresh, and the visibility coordinator removes renderer-window ownership when the sender disappears. This does not create repositories, change GitHub credentials, update user PRs, or silently run `gh` during a test.

## Source verification

- Direct Node Vitest forks **2/2 PASS** across a new actual PR IPC registration/validation test and the adjacent startup topology repair test. The new test verifies the exact four channel names, absence of Orca account/star channels, rejection of forged repo IDs/paths for enqueue and visibility reports, and window-lifetime cleanup. The topology test verifies that startup invokes the retained registration without compromising the durable duplicate-PTY repair.
- Node/renderer TypeScript **PASS**.
- Oxfmt and native/type-aware Oxlint with denied warnings **PASS**.
- Electron source desktop bundle **PASS**, sandbox preload verified. Existing ineffective dynamic-import warnings remain.
- Source ledger **PASS**: 33,506 upstream source records, 247 documented adapted source files, 8,260 documented removals; original MIT attribution/license hash intact.
- CI foundation workflow now executes the new focused Node-forks IPC test.

## Real desktop evidence on the exact code commit

A native Arch Linux/Hyprland Wayland Electron source app was launched with isolated HOME, XDG directories, Ash userData, CODEX_HOME, CLAUDE_CONFIG_DIR and browser state at `/tmp/ash-gui-ready-qa-8dMlaU/`. No normal user repositories, real provider credentials, other app profiles, or hooks were read or mutated.

The mapped `ash-ide` window displayed title *Ash IDE*, Main's first-window readiness barrier completed, the disposable local runtime pointer existed, and a renderer reload finished while console, stderr, CDP logs and window state were captured. The actual Electron `ipcMain` map contained **539 handlers** (baseline 535), including exactly the four retained GitHub PR-refresh routes. Neither Orca star/account handler was present. `window.api.gh.reportVisiblePRRefreshCandidates` resolved `true` with an empty candidate list, and a forged unregistered-repository list settled without scheduling a PR refresh (independently asserted by the new unit test).

**13/13 native assertions PASS.** Compared with the immediately preceding main baseline `6e71284c` (private `/tmp/ash-gui-ready-qa-F78g3I/`), distinct missing startup IPC handler names fell from **6 to 5**, with exactly `gh:reportVisiblePRRefreshCandidates` removed and no new names. The remaining five are `rateLimits:get`, `skills:discover`, `ssh:importConfig`, `ssh:listTargets`, and `updater:getStatus`.

The test-owned terminal daemon and local runtime both stopped through isolated profile-scoped CLI commands (exit code 0); no processes referencing this profile remained. All native screenshots/events remain in the private test directory, not the public repository.

## Acceptance limits

The native test demonstrates correct retained handler registration, IPC delivery, authorization filtering for forged repo paths in the isolated unit test, and window lifecycle cleanup. It does **not** prove authenticated GitHub PR fetching against a real remote, PR creation or PR review integration. Those require a user-authorized authenticated test with appropriate repositories, or a provider mock fixture with a real registered disposable Git repository.

The retained usage/rate limit, provider-native skills, ordinary Git SSH and Ash-owned updater startup channels remain to repair. The inherited `ORCA` Landing branding is still visible. Windows/macOS, AppImage packaging, real agent turns, SessionStart correlation, full M2 and complete M8 exclusion remain **OPEN**. This feature requires exact-tip hosted CI, deliberate main integration, post-integration checks and hosted main CI for acceptance.
