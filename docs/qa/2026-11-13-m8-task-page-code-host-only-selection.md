# M8 — Exclude Jira/Linear from the active Tasks source picker

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `8b7d9e46be865611890a6b72a57c0beaf8669c9d`; GitHub Actions run `43405613911` completed successfully.
**Isolated branch:** `fix/m8-task-page-code-host-only`, using its own Git worktree at `/home/suraj/projects/Ash-IDE-worktrees/m8-task-page-code-hosts`.

## Finding

The previous Jira/Linear settings and onboarding exclusions did not cover the actual Tasks view. `useTaskPageRepoSelection()` still consumed legacy global provider preferences and `restoreAvailableDefaultTaskProvider()` could expose both Jira and Linear task-source buttons. A saved Jira-only source could also become the sole fallback when GitLab was unavailable. The provider's former RPC and credential functionality has been excluded, so these controls were broken and prohibited.

## Change and scope

- Added an Ash-specific, pure policy in `ash-task-page-source-policy.ts` that accepts only GitHub or GitLab as Tasks page sources, and uses GitHub as the fallback for an all-retired saved list.
- Applied the policy only at the Tasks page selection boundary, not to the shared persisted schema or unrelated issue-reference parsing. A saved retired default is repaired in memory to a code-host source; unavailable GitLab falls back to GitHub for display.
- The Tasks picker and hide-source action only expose/operate on supported providers. Explicit hide writes use only code-host provider names; mounting the view does not modify saved provider preferences.
- Retained GitLab issue browsing when its CLI is available and the existing GitHub default behavior.

## Observed verification

- **Red-first:** all three original tests failed on the unmodified selection hook. A Jira/Linear-only legacy profile showed both excluded tabs; a GitLab-plus-tracker profile retained excluded tabs and Jira default; a missing GitLab CLI fell back to Jira.
- **Green after fix:** four focused tests passed, including refusing excluded hide-source actions and saving only code-host preferences after an explicit GitLab hide.
- Expanded renderer selection/onboarding/privacy tests: **12 passed across five files**. Renderer TypeScript (`config/tsconfig.tc.web.json`), targeted Oxlint/Oxfmt and Git whitespace checks: **passed**.
- Full typecheck, desktop assets, bundled CLI, AppImage, desktop lifecycle, source provenance, and hosted CI are tracked in the post-integration evidence; none should be inferred from earlier commits.

## Open gates

The Tasks page's legacy internal Linear/Jira hooks and dialog modules still require a separate dependency-safe refactor. This selection-level fix prevents their tabs and saved-source fallback from being exposed, but does not claim those source modules or their renderer chunks are absent from the package. A mounted desktop visual walkthrough and real GitHub/GitLab authenticated issue flow remain separate acceptance checks. No native provider account, credential, or saved user setting was modified by these tests.
