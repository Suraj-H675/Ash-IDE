# M8 — Retire Jira/Linear account claims from Tasks source summary

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `5146e53067c67807e21e618f3f0732dcb46c1d64` (previously verified metadata-request exclusion; new GitHub CI tracked independently).
**Isolated worktree:** `/home/suraj/projects/Ash-IDE-worktrees/m8-task-page-code-hosts`, branch `fix/m8-task-page-code-host-source-summary`.

## Observed gap

The Tasks picker, source buttons and metadata-fetch stage no longer offer Jira or Linear. However, the retained source-summary hook still contained an account-backed branch that generated Jira/Linear source claims from stale task-source state and legacy account names. Thus an old persisted or external task-page snapshot could still display a retired provider as an available task source, including its account/site label. The code also retained dependencies on legacy account-backed availability and selection fields.

## Correction

- `useTaskPageSourceDisplay` now accepts only `github` and `gitlab` when formatting a provider source summary. A stale or excluded task source receives neutral text: **Select a code host** / **Choose GitHub or GitLab to browse issues.**
- Removed the unused account-backed Jira/Linear summary branch and associated source-account selection dependencies from that hook. Existing GitHub Projects and GitHub/GitLab repository-backed source summaries remain intact.
- The guard does not mutate saved preferences or provider account state; the earlier Tasks selection policy remains responsible for restoring a supported active source.

## Test evidence

- **Red-first:** mounted source-summary tests showed stale Linear state returning `Linear · Local Linux · Private Linear account` and Jira returning `Jira · Local Linux · Private Jira site`. Both cases now return the neutral summary without an account name.
- Five focused cases passed: stale Linear and Jira summaries, GitHub and GitLab repo-backed summaries, and GitHub Projects mode. The related metadata, source-selection, presentation, onboarding and privacy regression sweep passed **29 tests across ten files**.
- Targeted formatter, linter and whitespace checks passed. Renderer TypeScript passed on the isolated worktree. Integrated full repository, package, lifecycle and hosted CI checks are recorded separately after observation.
- All test account/source inputs are synthetic and no native provider account, credential, user repository or saved preferences were accessed or changed.

## Open M8 gates

The broader Tasks pipeline still imports retired Jira/Linear state and effect modules, and the bundle/source exclusion audit continues. This slice does not assert complete EX-07 or EX-10 acceptance, authenticated GitHub/GitLab issue workflows, full visual parity, rollback, or Windows/macOS package acceptance.
