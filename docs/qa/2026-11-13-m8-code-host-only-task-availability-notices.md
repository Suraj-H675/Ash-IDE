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
- Full integrated typecheck, standalone runtime and desktop builds, packaged AppImage runtime, provenance and hosted CI are recorded after independent observation rather than inferred from prior commits.

## Open acceptance gates

Other historical Tasks state, effect, creation and cache modules still exist and may retain provider-specific logic. The parallel connection-polling branch is not changed here. This milestone does not demonstrate full EX-07/EX-10 bundle exclusion, real authenticated agent/provider flows, all-screen GUI parity, updater/rollback or Windows/macOS acceptance.
