# M8 — Exclude retired tracker availability notices from Tasks

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `75a3514e12309900d47c3b52b5adb8989a2d1b8c` (GitHub Actions `43452252150`: success).
**Isolated worktree:** `/home/suraj/projects/Ash-IDE-worktrees/m8-task-page-code-hosts`, branch `fix/m8-task-page-code-host-availability-only`.

## Finding

EX-07 excludes Jira and Linear integration screens, credentials and active provider behavior. Although Ash's Tasks source picker, dialogs, metadata fetch and account-source summaries had been retired, `useTaskPageSourceSummary` still constructed provider-level Jira/Linear host-availability warnings. Even a GitHub/GitLab selection carried these obsolete notices in its model; a legacy Jira/Linear task selection could display a blocking prompt asking to reconnect an unavailable retired tracker.

## Correction

- Source-specific availability notices are generated only for retained GitHub and GitLab repository-backed task sources. A stale Jira/Linear selection returns no active source notice.
- Removed the now-unused account-host availability calculation from `useTaskPageSourceAvailabilityPrelude` and its intermediate model contract. The account host/source contexts used by other legacy pipeline stages are deliberately preserved for separate review.
- Existing GitHub/GitLab unavailable-source notices, including blocking missing-provider-auth warnings, remain unchanged. No persisted provider preference, credential, or native account directory is modified.

## Verification

- **Red-first:** all four new cases failed against the previous code. Jira and Linear produced blocking reconnect warnings; GitHub/GitLab selections still had retired tracker warnings in their provider-notice map. All four passed after the change.
- Expanded renderer/Tasks, onboarding and privacy regression suite: **33 passed across 11 files** on the isolated worktree.
- Targeted Oxlint, Oxfmt and renderer TypeScript (`config/tsconfig.tc.web.json`) passed. The authoritative feature/acceptance pack defines EX-07 and EX-10 as independent complete-exclusion requirements, not satisfied by a green UI fixture alone.
- **Post-integration canonical main at `d666589c9eeb5f19f8b73bfb80c05d310258b6a4`:** full `pnpm run typecheck` passed; the expanded renderer regression suite passed **33/33 tests across 11 files** again. Desktop asset/CLI and standalone `orcad` builds passed (254 renderer chunks, 7,824.2 KB minified boot graph, sandbox preload, 1,224 CLI closure files/three commands; `orcad` 12.79 MB with 8,148 modules and no Electron or `node:sqlite` imports). Pinned provenance verified **33,506 upstream file records, 515 Ash adaptations, 8,508 exclusions**, with the MIT license notice retained.
- **Fresh Linux AppImage:** `dist/ash-ide-linux.AppImage`, **224,399,927 bytes**, SHA-256 **`652cee9a97d1a1fe9a9eac89e15c7bbc9d9f81fc98c85c94dd204a8c8e437bb0`**. Packaging verified 5,201 archive entries, glibc/native libraries, daemon entrypoint, bundled Node PTY and two bundled plugin resources.
- **Native Wayland package lifecycle:** **PASS** in an isolated compositor and disposable homes. App PID `3553024`, runtime ID `ab0d46d0-7684-44e6-9355-6c921db844af`, terminal handle `term_c336fa1a-8ef4-46eb-bc5c-d3192d9949f9`, terminal PID `3553616` survived the last-window GUI close/reopen. The test-owned daemon and runtime stopped; private logs retained at `/var/tmp/ashwl.G0T5z0`.
- Previous GitHub Actions `43452252150` for base `75a3514e` passed. Hosted CI for this newer commit must be checked separately and is not presumed successful.

## Open acceptance gates

Other historical Tasks state, effect, creation and cache modules still exist and may retain provider-specific logic. The parallel connection-polling branch is not changed here. This milestone does not demonstrate full EX-07/EX-10 bundle exclusion, real authenticated agent/provider flows, all-screen GUI parity, updater/rollback or Windows/macOS acceptance.
