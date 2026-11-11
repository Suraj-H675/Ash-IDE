# M8: retire live Orca Cloud skill UI and preload IPC forwarding

**Date:** 2026-11-11

**Base:** `main` at `b782351d3f8149d6cc4926d89a301b1af899d36e`

**Scope:** One bounded follow-up to removal of the dormant vendor skill IPC backend and its Settings page. Not an M8 release acceptance or installed-skill migration.

## Implemented

- The live **Skills** page no longer mounts the unsupported Cloud `SkillShareDialog`, `SkillInstallDialog`, `SkillInstallManagementDialog`, or the owned Cloud shared-links view. Removed associated Share, Install from link, Shared links, and Manage installs controls from the header, toolbar, rows, detail dialog, and empty state.
- **Retained:** provider-native skill discovery and refresh; filtering by source/agent; skill details; Reveal file / Copy path; and the pre-existing, capability-gated skill deletion UI/call path. Selection is delete-only and still enforces the existing batch limit.
- The skill-empty-state message now directs users to add a skill in their agent's native skills directory, not an unavailable Cloud bundle.
- The desktop `skills-bridge.ts` no longer sends IPC requests or subscribes to progress events for retired Cloud share, package, managed-install, or unlisted-link operations. The browser-client fallback also returns an explicit **unavailable in Ash IDE** error. The legacy method signatures are temporarily retained as *rejecting compatibility stubs* so unmounted Cloud dialog source can be pruned in a future audited change without weakening retained skills functionality.
- Disabled the renderer's old vendor skill-share deep-link listener and deleted the dev-only Cloud share-preview launcher; left other app deep links and browser behavior untouched. Removed the obsolete shared-links-only view type.
- Documented the two deleted upstream files and their pinned SHA-256 hashes in the source exclusion ledger; preserved source/license provenance. Did not access or modify real user skill directories, provider accounts, repository files, or MCP configuration.

## Verification

- `src/preload/api/ash-excluded-skill-cloud-preload.test.ts` verifies **19** obsolete desktop Cloud methods reject before IPC, Cloud progress no longer subscribes, and the retained `skills:discover` / skill-delete IPC method names remain wired.
- `src/renderer/src/components/skills/ash-excluded-cloud-skills-page.test.tsx` verifies excluded live entry points, retained discovery and row actions, an interactive Delete skills header, and the working native-folder/Refresh empty state.
- Combined focused and adjacent regressions: **5 suites / 12 tests passed**, including the previous Settings Skills shortcut and production provider-native discovery tests.
- Full TypeScript check: **passed** after the code edits (test-only assertion fixed before final acceptance).
- Changed-code quality gate: **passed** with **zero new findings across 14 changed code files**.
- Electron source build: **passed**, including sandbox preload check; **255 renderer chunks / 7,836.0 KB minified**. Pre-existing chunk-size and dynamic-import warnings remain.
- Pinned source provenance verification: **33,506** upstream records, **390** Ash source adaptations, **8,407** documented upstream exclusions, original MIT license SHA-256 unchanged (`ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`).

## Not accepted by this slice

- The old unmounted skill Cloud dialog components, shared skill Cloud contracts, runtime/RPC/CLI vendor sharing services, and some legacy main-process/deep-link or UI store declarations still exist. Compatibility stubs are not support for their functionality. Audit and remove those layers separately, preserving provider-native skills/MCP and legitimate local installations.
- Desktop skill-delete *wiring* was kept intact, **but a successful live native skill-delete transaction was not verified**. The current main-process skill IPC startup registration was previously confirmed to expose only `skills:discover`; audit the deletion backend independently before claiming this user action works in a packaged desktop build.
- The existing bundled-skill plan/update APIs were deliberately left unchanged pending a separate native/provider skill-update audit.
- No new native Wayland/X11 application smoke, package-level AppImage test, Windows/macOS build, or shipped-app release verification was performed for this UI/preload slice. GitHub CI is reported by the exact pushed commit/run rather than inferred from local results.
