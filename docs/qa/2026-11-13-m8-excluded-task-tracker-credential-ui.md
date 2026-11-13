# M8 — Retire Jira/Linear credential entry from retained setup and Settings

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `1dcb12ef80cdc8b4face49ea072bdd2707aba382` (GitHub Actions `43397256170`: success).
**Branch:** `fix/m8-exclude-tracker-credential-ui`, isolated in the existing Codex settings worktree.

## Requirement and finding

EX-07 excludes Jira and Linear application integrations; retained GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea source-control connections must continue working. The existing onboarding feature wall and Settings > Integrations rendered `LinearIntegrationCard` and `JiraIntegrationCard` (including the Linear API-key dialog), even though backend removal has been proceeding independently. Settings > Tasks also offered the excluded provider setup and skill workflow. Passive setup and progress effects still polled Jira/Linear connection status and could misreport a task-source step as complete based on stale tracker state.

## Correction

- Removed both task-tracker credential cards from setup and Settings > Integrations, preserving retained source-control integration cards.
- Settings > Tasks now offers only GitHub/GitLab issue sources, including for existing profiles whose saved visible providers/default source still contain Jira/Linear. The Settings UI writes only supported providers on the next explicit toggle; it does not silently alter existing saved settings on mount.
- Removed excluded-provider checks from integration refresh, feature-wall task presentation, setup-guide progress, and task-provider readiness. Setup task-source completion now derives from connected GitHub/GitLab issue availability; unrelated review providers remain available for PR/MR review status.
- Removed obsolete Jira/Linear search hints and introduced Ash-specific translation fallback keys for changed wording, avoiding inherited localized copy that advertises excluded integrations or calls the product Orca on these surfaces.

## Evidence

- **Red-first:** two independent server-rendered UI regressions failed on the original code because Settings and setup rendered the excluded credential cards. Both pass after the fix.
- **Six focused tests passed**: source-control Settings preservation, feature-wall setup preservation, legacy task-preference filtering, a mounted hook test proving no Jira/Linear connection checks are dispatched while the code-host preflight refresh is sent, plus two pure-state regressions checking GitHub task readiness and that Bitbucket review status alone cannot complete task-source setup.
- Renderer TypeScript compiler (`config/tsconfig.tc.web.json`) passed; targeted lint and formatting passed. The full build, provenance checks, and GitHub CI are recorded separately after integration.
- The tests use mocked source-control cards, disposable renderer state, and no provider credentials or external services.

## Out of scope and remaining gates

The separate task dashboard, CLI, shared provider model, persistence, bundled renderer assets, and source files still need exclusion audits. The historical provider names may remain in stored settings until a separately reviewed migration is designed. This step does **not** claim that all Jira/Linear code has been removed from the shipped bundle, that existing credentials have been touched, or that full M8 EX-07 / EX-10 acceptance has passed.
