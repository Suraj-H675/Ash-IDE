# M8 English-only UI and plugin language-pack runtime retirement

## Scope

**Status:** verified uncommitted isolated feature branch; not integrated or pushed.

- Date: 2026-11-18
- Worktree: `/home/suraj/projects/Ash-IDE-worktrees/m8-enforce-english-only-ui`
- Branch: `fix/m8-enforce-english-only-ui`
- Base: `1bf7be31dc1c01845e060733682eeab7f4e6b40a`

This is one bounded source and runtime slice of M8. M8 remains incomplete.

## Product requirement

Product decision D-047 and `02_PRODUCT_SPECIFICATION.md` require an English-only UI. `03_FEATURE_CAPABILITY_MATRIX.md` excludes general app-plugin skill and MCP marketplaces, and classifies the UI as English-only. `05_ORCA_SOURCE_REUSE_MAP.md` identifies plugin language-pack registration as part of the general app-plugin contribution system. This change removes the UI language switch path and its renderer language-pack runtime, then closes the dormant Main language-pack backend so the excluded application-plugin translation path is absent from manifest, validation, preload, packaging and authoring boundaries.

## Changes

- Removed the onboarding language switcher and its open-state keyboard handling, and removed the Appearance language control, language search terms, and language summary text.
- Made the renderer i18n provider select English and mark the existing app-shell readiness gate ready. Children render immediately so the app shell can show its existing English loading surface if a legacy locale must be reset. Renderer Intl formatting always uses `en`.
- Removed renderer plugin language-pack loading and registration, its store, and its shared resource helper. Removed unused system-locale selection and locale-loading modules.
- Made Main i18n English-only. The retained `setMainUiLanguage` compatibility function always selects English; startup preparation and Main dialogs use English as well.
- Removed the system-language IPC and preload bridge path. TCC notices no longer inspect a selected locale or plugin language packs.
- Retired the remaining Main language-pack contribution registry, artifact parser/coverage/policy modules, manifest contribution point, artifact validation, strict authoring path, and `PluginsApi.listLanguagePacks` type surface. Built-in source locale catalogs remain untouched as source/provenance material.

## Persisted settings compatibility

`GlobalSettings.uiLanguage`, its schema, and normalizers remain available to read old data. New and missing preferences default to English. Valid saved values such as `system`, built-in locale identifiers, and `plugin:*` are ignored by the UI; English is used without rewriting the saved value. Startup and mount paths do not call `updateSettings` to migrate or normalize `uiLanguage`. The deprecated Portuguese migration marker is retained as compatibility data and no longer triggers a save.

## Verification

- Focused Vitest run covering the English-only regression, excluded language-pack backend, existing locale exclusions, plugin-host boundary, onboarding, terminal notice, dashboard, and tray behavior: **9 files, 72 tests passed**.
- `node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs`: **passed**.
- Oxfmt `--check` on changed files, including the new regression: **passed**. A repository-wide formatter check reports 80 existing formatting issues across unrelated repository files; changed files were formatted and pass individually.
- Oxlint `--deny-warnings` on changed TypeScript and TSX files: **passed**. A repository-wide source lint run reports existing violations in unrelated files.
- `pnpm --config.manage-package-manager-versions=false run build:desktop:assets`: **passed**. Workspace packages type-checked during the build, Electron/Vite built Main, preload and renderer, the renderer boot graph reported 216 chunks, and the bundled skills CLI runtime verified 1,075 closure files and 3 commands. The generated Main/renderer bundles contain no language-pack runtime references or non-English locale-loader references.
- `git diff --check`: passed.
- `node --check config/scripts/workflow/source-routing/pr-plugin-e2e-source-routes.mjs`: **passed**.
- `node config/scripts/provenance/verify-source-ledger.mjs` passed from the normal DevSpace workspace shell: **33,506 upstream records, 695 Ash edits, 8,868 documented removals**, and pinned MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`. The provenance verifier ran successfully from the normal DevSpace workspace shell.

## M8 status

M8 is not complete. This slice retires English-only language selection and the full application-plugin language-pack vertical; the remaining M8 removal slices, packaging/release proof, and desktop acceptance gates still remain.
