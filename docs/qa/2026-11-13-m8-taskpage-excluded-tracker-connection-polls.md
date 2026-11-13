# M8 — Stop excluded Jira/Linear connection polling on Tasks entry

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `a76a45e972084c20e65ce76fe50889ccb40b9f53` (previous Feature Wall and Settings Linear exclusion).
**Isolated branch/worktree:** `fix/m8-stop-taskpage-tracker-connection-polls`, existing M8 isolated settings worktree.

## Finding

The inherited Tasks page's `useTaskPageGlobalEffects` executed connection checks for **both** Jira and Linear on initial mount whenever their cached status was not ready, even if the user was viewing retained GitHub/GitLab issues. The current Ash product excludes those application-level connectors. Other source-specific list effects have task-source guards, but this global probe did not.

## Change

- Removed only the unconditional Jira/Linear connection-check dispatch from the Tasks global effect. Retained local preflight refreshing for GitHub/GitLab remains unchanged, including missing/stale readiness handling.
- Removed unrelated provider-context dependencies from that effect, avoiding extra work when old tracker settings change.
- Preserved Tasks keyboard dismissal, source-control work-item UI, user data and settings. The legacy tracker source selector, dialogs, source-specific reads and stored settings require a separate complete cleanup; this change makes no claim that the Tasks page cannot still reach them through an explicitly selected source.

## Evidence

- Two mounted React hook regressions were **red-first**: with stale and current Git preflight state, opening Tasks incorrectly dispatched excluded connector checks. Both now pass, while the stale preflight path refreshes once and the current path does not need a refresh.
- Targeted Oxlint/Oxfmt checks and targeted Vitest passed. Wider renderer/type/provenance/integrated package/CI results are recorded separately when observed.

## Remaining exclusion acceptance

EX-07 and EX-10 are **not complete**. Tasks still carries a large inherited provider-specific model/selector/dialog graph; removing one global effect does not establish absent RPC, shipped source, or UI paths. No provider credentials or existing profile data were read or modified as part of the disposable test.
