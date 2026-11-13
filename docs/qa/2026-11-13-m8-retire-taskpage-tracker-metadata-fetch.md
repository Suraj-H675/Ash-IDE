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
- Renderer TypeScript (`config/tsconfig.tc.web.json`), Oxlint/Oxfmt and whitespace checks passed in the isolated worktree. **After fast-forward integration** at `d14b2f350022722af9769d6ffffca2c28d73b231`, the full repository `pnpm run typecheck` passed and the combined renderer test suite passed **24/24 tests across nine files**.
- `pnpm run build:desktop:assets` passed, verifying 254 renderer chunks (7,824.2 KB minified), sandbox preload and the 1,224-file CLI closure with three supported commands. `pnpm run build:orcad` passed (12.79 MB, 8,148 modules, zero Electron or `node:sqlite` imports). The pinned Orca provenance verifier passed with **33,506 upstream records, 512 adapted Ash sources and 8,508 documented exclusions**, retaining the MIT license notice.
- A fresh Linux AppImage built from integrated `main`: `dist/ash-ide-linux.AppImage`, **224,399,968 bytes**, SHA-256 **`6a4c412166b52ad81721bd8a5a171f50e0b28e7b81584ff48353625cf064919f`**. Packaging checked 5,201 ASAR entries, bundled daemon startup, glibc/native compatibility, bundled Node PTY and two plugin resource bundles.
- The real Wayland AppImage last-window lifecycle fixture **passed** with disposable homes and private compositor: app PID `3502082`, runtime ID `c75d0331-6568-48ed-9195-2fc58108870d`, terminal handle `term_30f322a0-3d1b-4bd5-9d44-8e3665a8bf57`, and terminal PID `3502682` persisted across GUI close/reopen. Test-owned runtime/daemon were stopped; private logs retained at `/var/tmp/ashwl.3dRjBm`.
- The hosted GitHub CI result for the final pushed HEAD must be checked independently; a green preceding run is not evidence for the successor.
- Tests inject fake provider clients using disposable renderer mounts; no real account, credential, provider server, or user repository is accessed or changed.

## Remaining gates

Other inherited Tasks modules still import or construct Jira/Linear data/creation/effect services. Separate reviewers are addressing connection polling, so this change does not modify those files. The overall feature-exclusion gate, authenticated provider smoke tests, visual parity, update/rollback and Windows/macOS acceptance remain open.
