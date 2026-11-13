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
- Renderer TypeScript compiler (`config/tsconfig.tc.web.json`) and integrated full `pnpm run typecheck` passed; targeted lint and formatting passed. The canonical post-integration renderer checks passed **13 tests across six files**, covering retained privacy, updates, and skills settings as well as these three focused regression files. Pinned source provenance verified **33,506 upstream file records, 501 Ash adaptations, and 8,508 documented exclusions**.
- Canonical `main` implementation commit: `208a4f812b7bf745db3e1ae6582879aecee73188`. `pnpm run build:desktop:assets` passed (255 renderer chunks, sandbox preload, and verified CLI closure); `pnpm run build:orcad` passed (12.79 MB, 8,148 modules, zero Electron / `node:sqlite` imports).
- A fresh Linux AppImage was built from that commit: `dist/ash-ide-linux.AppImage`, **224,489,927 bytes**, SHA-256 **`22cecee7eb9464f3bb481bfe5e93f8598516db9ea5cffcde29b82e91a3ced0dd`**. Linux native dependency, daemon-entry, bundled Node PTY, plugin-resource, and package hygiene checks passed.
- Real packaged Wayland lifecycle verification passed in a private virtual KWin compositor with disposable provider homes: app PID `3141352`, runtime ID `1d804d68-bfb4-4ba3-82b0-464c941326c7`, terminal handle `term_bf0420bb-2df0-40df-b3c1-82f098087142`, terminal PID `3141930` persisted across last-window close and reopen. Test-owned runtime and daemon stopped; evidence retained at `/var/tmp/ashwl.QZotX2`. This checks desktop/runtime continuity, **not** a visual assertion of all integration screens or signed-in provider behavior.
- New hosted GitHub CI status must be confirmed for the final pushed HEAD; success of the prior base run does not prove this change.
- The tests use mocked source-control cards, disposable renderer state, and no provider credentials or external services.

## Out of scope and remaining gates

The separate task dashboard, CLI, shared provider model, persistence, bundled renderer assets, and source files still need exclusion audits. The historical provider names may remain in stored settings until a separately reviewed migration is designed. This step does **not** claim that all Jira/Linear code has been removed from the shipped bundle, that existing credentials have been touched, or that full M8 EX-07 / EX-10 acceptance has passed.
