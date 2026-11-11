# M8: remove orphaned vendor Cloud skill publishing renderers

**Date:** 2026-11-11

**Base branch / HEAD:** `main` at `96dd0d3da430b384b8fe3869dac74cd547bfcf6c`

**Acceptance scope:** one audited source-deletion slice. This does **not** constitute M8 or native desktop release acceptance.

## Reachability and preservation boundary

The previous M8 checkpoint detached Orca Cloud publishing, owned-share links, and managed-install controls from the active `SkillsPage.tsx`; the obsolete source modules remained on disk. A current import/caller audit confirmed that the Cloud **publish** and **owned-links** subtrees had no production entrypoint. This checkpoint deletes only the following nine upstream-derived files:

1. `SkillShareDialog.tsx`
2. `SkillShareReviewContent.tsx`
3. `SkillShareReleaseNotesField.tsx`
4. `SkillSharePackageSummary.tsx`
5. `SkillSharedLinksView.tsx`
6. `SkillSharedLinkRow.tsx`
7. `use-owned-skill-shares.ts`
8. `skill-share-selection.ts`
9. `skill-share-package-selection.ts`

All paths above are relative to `src/renderer/src/components/skills/`. Their original, pinned SHA-256 values and exclusion reasons are preserved in `docs/provenance/ash-exclusions.json`. The Settings regression that previously inspected `SkillShareDialog.tsx` now asserts that the retired file is absent; a new regression test and the Foundation CI workflow guard the removed tree against reintroduction.

**Preserved:** `SkillsPage` native/provider skill discovery, skill inventory, native file reveal/copy, the existing skill-delete UI path, installed-agent skills notifications and independent skill-update components. `SkillPackageChecklist.tsx` and `skill-share-preview-summary.ts` remain because the still-present skill install review imports them; `skill-share-version-summary.ts` remains for the same audited reason. No real user skills, MCP config, provider credentials, local runtime sessions, or app profiles were modified.

## Validation evidence

- **Focused regressions:** 6 Vitest suites / **14 tests passed**. Includes two new source-exclusion and preserved-dependency assertions plus active Skills-page, Settings shortcut, native skill discovery, and excluded preload/IPC tests.
- **Full TypeScript typecheck:** `pnpm run typecheck` **passed**.
- **Changed-code quality:** `pnpm run check:code-quality:changed` **passed**; 0 new findings across 2 changed code files (deleted upstream files are not treated as editable changed lines).
- **Electron source bundle:** `pnpm run build:electron-vite` **passed**, including sandbox preload verification; 255 renderer chunks and 7,836.0 kB minified. The pre-existing large-chunk and ineffective dynamic-import warnings persist.
- **Provenance verifier:** **passed**, with 33,506 pinned Orca source records, **388** adapted Ash source hashes, **8,416** documented upstream removals, unchanged original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Formatting, staged diff checks, Git integration and GitHub CI are finalized separately before the handoff. No new packaged app or live GUI test was performed in this slice.

## Open boundary and next audit

Unmounted Cloud **install-from-link** / managed-install dialogs and ancillary skill-package UI remain in source, alongside unused first-party Cloud skill runtime contracts and preload compatibility signatures. They require a separate import-graph and local/provider-native installer ownership audit before deletion. This milestone does not establish that local skill deletion works: the main-process handler registration for `skills:previewDelete` and `skills:delete` remains a separate acceptance issue. Do not mistake an existing renderer button or passing source build for verified working IPC.
