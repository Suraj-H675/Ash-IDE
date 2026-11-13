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
- Targeted formatter, linter and whitespace checks passed. Renderer TypeScript passed on the isolated worktree. **After fast-forward integration** at `c689c9808c3f4fc062a222e6d9ab6beafce155c9`, full `pnpm run typecheck` and the same **29 renderer tests across ten files** passed on canonical `main`.
- `pnpm run build:desktop:assets` passed (254 renderer chunks, 7,824.2 KB minified boot graph, sandbox preload, 1,224 CLI closure files and three supported commands). `pnpm run build:orcad` passed (12.79 MB, 8,148 modules, no Electron or `node:sqlite` imports). Pinned Orca provenance verified **33,506 upstream records, 513 Ash adaptations, 8,508 documented exclusions** with the preserved MIT notice.
- Fresh Linux AppImage built from integrated `main`: `dist/ash-ide-linux.AppImage`, **224,399,923 bytes**, SHA-256 **`f61c32d3136577f71a2c04d5424449bb6f5f1f3bdceceb997dfba63a5c656e44`**. Packaging verified 5,201 ASAR entries, bundled daemon entry, native glibc compatibility, Node PTY, and two plugin resource bundles.
- Real packaged Wayland last-window lifecycle fixture **passed** in a private compositor with disposable provider homes: app PID `3525840`, runtime ID `78ca4a22-233d-4aab-ae6e-a53c04cf8265`, terminal handle `term_b0cd79e8-5965-42f1-800d-850f96ff38d7`, terminal PID `3526441` persisted across GUI close/reopen. Test-owned runtime and daemon stopped; private logs at `/var/tmp/ashwl.7ol2Jj`.
- Previous GitHub CI run `43450354735` for base `5146e530` passed. Hosted CI for this successor commit must be checked separately and is not implied by that result.
- All test account/source inputs are synthetic and no native provider account, credential, user repository or saved preferences were accessed or changed.

## Open M8 gates

The broader Tasks pipeline still imports retired Jira/Linear state and effect modules, and the bundle/source exclusion audit continues. This slice does not assert complete EX-07 or EX-10 acceptance, authenticated GitHub/GitLab issue workflows, full visual parity, rollback, or Windows/macOS package acceptance.
