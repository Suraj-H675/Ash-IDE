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
- **Post-integration canonical main commit `990ff84ca762b7d1fa86e924865c3ec878bd1092`:** full `pnpm run typecheck` passed, and all **20 renderer regressions across eight files** passed again. `pnpm run build:desktop:assets` passed (254 renderer chunks, 7,824.3 KB minified boot graph, sandbox preload, 1,224 CLI closure files and three supported commands). Standalone `orcad` build passed (12.79 MB, 8,148 modules, no Electron or `node:sqlite` imports). Pinned Orca provenance verified **33,506 upstream records, 511 Ash adaptations, 8,508 documented exclusions**, with MIT source notice preserved.
- The fresh Linux AppImage built from that commit: `dist/ash-ide-linux.AppImage`, **224,395,514 bytes**, SHA-256 **`c481a91a17b030280599b1e1d6de3f52f43a2149fa60cffbb76638352ed0f5af`**. Packaging hygiene passed for **5,201 ASAR entries**, with bundled daemon, native libraries, plugin resources and Node PTY verified. One fewer ASAR entry than the prior 5,202-entry build does **not** prove all legacy renderer hooks are gone.
- The real Wayland package lifecycle fixture **passed** in an isolated compositor and disposable homes: app PID `3475230`, runtime ID `795d4cda-af8d-4bd4-934b-ee77bed9fcfa`, terminal handle `term_49cb0094-4283-4157-b58d-3702d94f7535`, terminal PID `3475806` survived last-window closure and reopen. Test-owned daemon/runtime shut down; private logs at `/var/tmp/ashwl.WM6RHV`.
- Hosted GitHub CI for the final pushed HEAD must be observed independently; an earlier successful workflow does not verify a newer commit.

## Remaining gates

The upstream Tasks hook pipeline still imports legacy Jira/Linear data/effect modules; that larger graph requires a separate dependency-safe refactor before full bundled-renderer exclusion is accepted. Other persisted settings and provider surfaces are audited separately. This change does not establish authenticated GitHub/GitLab task operations, all-screen GUI parity or full M8 acceptance.
