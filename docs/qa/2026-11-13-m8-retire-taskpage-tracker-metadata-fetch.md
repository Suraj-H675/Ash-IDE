# M8 — Stop retired Jira/Linear Tasks metadata requests

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `64c38199149fb4e67ae19838998ce93877ee288a` (GitHub Actions `43446679878`: completed successfully).
**Worktree:** `/home/suraj/projects/Ash-IDE-worktrees/m8-task-page-code-hosts` on `fix/m8-task-page-no-tracker-metadata-fetch`.

## Finding

The Tasks page's picker, content and dialog surfaces had already excluded Jira/Linear. However, `useTaskPageProviderMetadata` still imported and called `jiraListProjects()` and `listLinearTeams()`/`getCachedLinearTeams()` when an inherited source had `taskResumeApplied` and stale `connected` state. This was a live request path for explicitly excluded task-tracker integrations, not just an orphaned bundle artifact.

## Correction

Removed both retired providers' metadata-fetch effects and their Jira runtime/default-host imports. The hook temporarily retains typed empty team/project state and setters to avoid changing the intermediate model contracts consumed by the remaining inherited Tasks hook pipeline. No Jira or Linear network/cache reads are initiated from this stage, including for stale saved provider selections. The GitHub/GitLab task pipelines are unchanged by this slice.

## Tests

- **Red-first:** two mounted-hook tests failed against the previous implementation: stale Linear fetched cached teams, and stale Jira invoked project listing. Both passed after removing the effects.
- The two supported GitHub/GitLab source cases also remain inert and passed. Focused Tasks page presentation, selection and metadata tests: **13 passed across three files**.
- Renderer TypeScript (`config/tsconfig.tc.web.json`), Oxlint/Oxfmt and whitespace checks passed in the isolated worktree. Full integrated, packaged and CI evidence is recorded separately after observation.
- Tests inject fake provider clients using disposable renderer mounts; no real account, credential, provider server, or user repository is accessed or changed.

## Remaining gates

Other inherited Tasks modules still import or construct Jira/Linear data/creation/effect services. Separate reviewers are addressing connection polling, so this change does not modify those files. The overall feature-exclusion gate, authenticated provider smoke tests, visual parity, update/rollback and Windows/macOS acceptance remain open.
