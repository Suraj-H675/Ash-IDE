# M8 — Exclude Jira/Linear from the active Tasks source picker

**Date:** 2026-11-13 (Asia/Kolkata)
**Original base:** `main` at `8b7d9e46be865611890a6b72a57c0beaf8669c9d`; GitHub Actions run `43405613911` completed successfully. Rebased onto `main` at `a76a45e972084c20e65ce76fe50889ccb40b9f53` after the independent Linear onboarding/Settings cleanup was integrated.
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
- After the clean fast-forward into canonical `main`, the four focused tests and the newly integrated onboarding/source-control tests passed together: **15 passed across seven files**. The full `pnpm run typecheck`, desktop asset/CLI build, standalone `orcad` build and source provenance checks also passed. Provenance verified **33,506 pinned upstream records, 505 adapted Ash source files, 8,508 documented exclusions**.
- A fresh Linux AppImage was built from implementation commit `b484ab2985174e8f455e3e479285033214c71939`: `dist/ash-ide-linux.AppImage`, **224,460,922 bytes**, SHA-256 **`05c8b561330e8c4fa9deebc723a19319e1fabe594e2c9519f04c4be62931421e`**. Packaging verified **5,202 ASAR entries**, native glibc compatibility, daemon startup, bundled Node PTY, and two plugin-resource bundles; the desktop asset build verified 254 renderer chunks, sandbox preload, and 1,224 CLI closure files/three commands. The local `orcad` build bundled 8,148 modules and no Electron or `node:sqlite` imports.
- The real AppImage Wayland lifecycle fixture **passed** in an isolated compositor and disposable homes: application PID `3369117`, runtime ID `071edda5-1e34-4738-855d-6951fb2b3bc6`, terminal handle `term_8bf378b2-9f17-4db2-9684-a6a336dbf0ce`, terminal PID `3369701` survived closing and reopening the last GUI window. The test-owned runtime and daemon stopped; private logs at `/var/tmp/ashwl.iaMvLS`.
- Hosted CI for the final pushed HEAD must be observed separately; earlier completed workflows do not verify a newer commit.

## Open gates

The Tasks page's legacy internal Linear/Jira hooks and dialog modules still require a separate dependency-safe refactor. This selection-level fix prevents their tabs and saved-source fallback from being exposed, but does not claim those source modules or their renderer chunks are absent from the package. A mounted desktop visual walkthrough and real GitHub/GitLab authenticated issue flow remain separate acceptance checks. No native provider account, credential, or saved user setting was modified by these tests.
