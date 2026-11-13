# M8 — Remove retired Jira/Linear presentation from the Tasks dashboard

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `6da1bcc425188e37eeaf31970dffc39791762daf` (GitHub CI `43431886812`: success).
**Isolated branch:** `fix/m8-task-page-renderer-surface-exclusion` in `/home/suraj/projects/Ash-IDE-worktrees/m8-task-page-code-hosts`.

## User-facing failure

The preceding Ash Tasks source-selection fix prevented a legacy saved Jira/Linear preference from re-enabling its source tab. However, `TaskPageSurface` still mounted both retired providers' creation and credential dialogs even when the active source was GitHub; `TaskPageContent` fell back to Jira content for any non-GitHub/GitLab source; `TaskPageProviderFilters` retained active tracker filters; and `SourceBar` retained Jira site and Linear workspace selectors. The source-options catalog also advertised both excluded tracker providers. These imports kept excluded presentation and credential-entry code reachable in the renderer.

## Correction and preservation

- `Surface.tsx` now mounts only retained GitHub issue and GitLab dialogs alongside the frame; the five retired issue/project/credential dialogs and their imports were removed.
- `Content.tsx` and `ProviderFilters.tsx` retain GitHub/GitLab lists and filters and return `null` for a stale excluded source rather than showing Jira fallback content.
- `SourceBar.tsx` no longer imports or renders Linear scope and Jira site controls. It also filters its displayed source options to GitHub/GitLab, even if an externally constructed legacy model contains other provider names.
- `getSourceOptions()` lists GitHub and GitLab only; the accompanying SourceBar fixture follows that catalog. Existing saved settings, credentials, native provider homes, and shared issue-reference parsing remain untouched.

## Tests and verification

- **Red-first:** three targeted presentation tests failed against the old surface/content/filter modules. An additional SourceBar/catalog regression showed legacy source controls and options were still present; both checks also failed before their correction.
- The five focused presentation tests now pass, verifying the retained GitHub/GitLab dialogs, lists, filters and source buttons, and asserting no Jira/Linear dialogs, fallback list, filters or source selectors.
- Expanded renderer tests: **20 passed across eight files**, including prior TaskPage source policy, onboarding, source-control integration and privacy regressions. Targeted Oxlint/Oxfmt, renderer TypeScript (`config/tsconfig.tc.web.json`) and `git diff --check` passed on the isolated branch.
- Final source provenance, post-integration builds, AppImage runtime checks and GitHub CI must be confirmed separately and only claimed after observation.

## Remaining gates

The upstream Tasks hook pipeline still imports legacy Jira/Linear data/effect modules; that larger graph requires a separate dependency-safe refactor before full bundled-renderer exclusion is accepted. Other persisted settings and provider surfaces are audited separately. This change does not establish authenticated GitHub/GitLab task operations, all-screen GUI parity or full M8 acceptance.
