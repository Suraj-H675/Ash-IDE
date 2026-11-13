# M8 — Remove retired provider reads from the Tasks page pipeline

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `edc277fcba4316fd3e31d912ea9080d9baf94050`; GitHub Actions run `43455549586` passed.
**Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-b1fa315b`, branch `fix/m8-taskpage-retired-provider-read-fences`.

## Changes

- Carried forward the isolated `fix/m8-stop-taskpage-tracker-connection-polls` change (`1d57db53`): opening Tasks no longer probes Jira/Linear connection status.
- Removed the Linear list, Linear in-Orca, Linear collection/custom-view, and Jira list-effect hooks from the mounted `TaskPage` pipeline. These effect-only stages no longer issue automatic task searches, linked-issue reads, project lists, or collection/view reads when Tasks opens.
- Removed saved Linear project/custom-view network restoration from `useTaskPageResumeRestoration`. Existing local resume preferences are retained; this change does not delete saved task state.
- Removed the Jira issue-type/create-field metadata stage and its renderer runtime-client import from the mounted Tasks pipeline; GitHub list projection now consumes the preceding state model directly.
- Added `isAshTaskPageProviderVisible`, the shared Ash Tasks code-host boundary. Jira priority metadata, favourite filters, quick filters, and saved filters now fail closed when stale Jira state is supplied, even if legacy connection state claims the account is connected.
- Updated the composer-actions stage to accept the model before the removed effect-only stages.

## Verification

- Focused regression suite: **38 tests passed across 13 files**, covering the new stale-provider read fences, removed Tasks effect stages, connection-poll exclusion, provider metadata, code-host source selection/presentation, onboarding, secondary surfaces, and privacy.
- Full repository `pnpm run typecheck` passed on this isolated worktree.
- Targeted Oxfmt and Oxlint passed with zero warnings/errors; `git diff --check` passed.
- Source provenance verified **33,506 upstream records, 526 Ash adaptations, 8,509 documented exclusions**, retaining the Orca MIT license notice. The removed upstream Jira metadata hook is explicitly recorded in `ash-exclusions.json` with its original source hash.
- `pnpm run build:desktop:assets` passed: 254 renderer chunks, 7,821.9 KB minified boot graph, sandbox preload verification, 1,224 CLI closure files and three commands.
- `pnpm run build:orcad` passed: 12.79 MB, 8,148 modules, zero Electron or `node:sqlite` imports. Native build and Electron runtime preparation passed.
- Fresh AppImage from committed HEAD `9c5006ec`: `dist/ash-ide-linux.AppImage`, **224,387,270 bytes**, SHA-256 **`4fe55ed60c580885d9590f5c69a160b52e747d3a741aa8ddd0f0a041f3934522`**. Packaging verified 5,196 archive entries, 15 native binaries against the Ubuntu 20.04 glibc floor, packaged daemon entrypoint, bundled Node PTY, and two plugin-resource bundles.
- Packaged Wayland close/reopen lifecycle **PASS**: app PID `3618113`, runtime ID `9d3ad106-5388-4bd6-9adc-1f1b775c6302`, terminal handle `term_57063467-c3a1-4fab-b05e-0d6b88a79430`, terminal PID `3618680` survived last-window GUI close/reopen. Test-owned runtime and daemon stopped; private logs at `/var/tmp/ashwl.lYo6az`.
- Tests used synthetic fixtures only. No Jira/Linear account, credential, user repository, or persisted provider preference was accessed or changed.

## Remaining M8 work / acceptance limits

- The TaskPage still contains legacy Linear/Jira state/projection and creation-state/action stages. They are not all removed by this milestone; the remaining creation callbacks and their unreachable UI/source modules require a separate deletion pass.
- This change does not claim complete EX-07/EX-10 acceptance across every application surface, IPC/RPC, settings, persistence, bundled assets, or scripts. Authenticated GitHub/GitLab workflows, full visual parity, rollback, and Windows/macOS package acceptance remain separate gates.
- Hosted CI for the successor commit must be checked after push; the base run above is not evidence for the successor.
