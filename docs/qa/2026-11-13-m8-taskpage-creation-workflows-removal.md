# M8 — Remove retired Jira/Linear Tasks creation workflows

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `f159b972535fc13298c917c23e71d27cc7c40e16` (GitHub Actions run `43462845353` passed).
**Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-07e67c7a`, branch `fix/m8-taskpage-creation-stage-removal`.

## Changes

- Removed the Linear and Jira creation-state and issue/project creation stages from the mounted `TaskPage` hook pipeline. The retained GitHub mutation/list stages now consume the preceding code-host model directly.
- Removed Jira and Linear TaskPage creation dialogs, field components, connection-dialog wrappers, creation hooks, Jira summary-generation hook, and the Linear project lookup hook.
- Removed the now-unmounted Jira/Linear Tasks list and filter presentation modules. The supported TaskPage content and filter components remain GitHub/GitLab only.
- Removed the old Jira/Linear draft-write helpers from TaskPage draft storage. The persisted draft store slice and existing user data were deliberately retained; no migration or deletion of saved data was performed.
- Preserved the Tasks contextual-tour trigger by moving it to the retained global-effects stage.
- Added regression assertions that the removed provider creation stages cannot be mounted from `TaskPage`.

## Verification

- Focused regression suite: **38 tests passed across 13 files**, covering stale-provider reads, tracker connection polls, provider metadata, code-host source selection and presentation, onboarding, secondary surfaces, and privacy.
- Full repository `pnpm run typecheck` passed.
- Oxfmt and Oxlint passed with zero warnings/errors; `git diff --check` passed.
- Source provenance verified **33,506 pinned upstream records, 529 Ash adaptations, 8,530 documented exclusions**, retaining the pinned Orca MIT license notice. All 21 deleted upstream files are recorded by source hash in `ash-exclusions.json`.
- `pnpm run build:desktop:assets` passed: 254 renderer chunks, 7,819.8 KB minified boot graph, sandbox preload verification, 1,224 CLI closure files and three commands.
- `pnpm run build:orcad` passed: 12.79 MB, 8,148 modules, zero Electron or `node:sqlite` imports.
- Native build tests and Electron runtime preparation passed.
- Fresh Linux AppImage: `dist/ash-ide-linux.AppImage`, **224,383,365 bytes**, SHA-256 **`625a58ca2bf1034c06e8a8f15975d8324d21da430a9543187e4405f299d04b71`**. Packaging verified 5,196 archive entries, 15 native binaries against the Ubuntu 20.04 glibc floor, packaged daemon entrypoint, bundled Node PTY, and two plugin-resource bundles.
- Packaged Wayland close/reopen lifecycle **PASS**: app PID `3709570`, runtime ID `9f1f262a-062e-44a5-9e5c-0510ec54db79`, terminal handle `term_ff64055f-39f4-4df3-85ab-7a3cf040aebd`, terminal PID `3710263` survived last-window GUI close/reopen. Test-owned runtime and daemon stopped; private logs at `/var/tmp/ashwl.5aaFvR`.
- No Jira/Linear account, credential, or external provider API was accessed. Verification used synthetic fixtures only.

## Remaining M8 / EX-07 limits

- This is a TaskPage vertical slice, not complete EX-07 acceptance. The wider Jira/Linear integration settings, shared provider/runtime IPC and persistence surfaces still require a separate removal/review pass.
- The TaskPage still carries legacy Linear/Jira state and store projections for compatibility; guarded provider reads are not equivalent to proving all provider code is absent from the packaged application.
- X11 lifecycle, full cross-platform release certification, updater rollback, and whole-application EX-01–EX-10 scans remain outstanding. Hosted CI for the successor commit must be checked after push.
