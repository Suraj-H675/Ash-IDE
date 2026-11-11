# M8: retire Orca Cloud skill-sharing Settings

**Date:** 2026-11-11
**Base:** `main` at `a70e60baad9c9d16fb004c0c180b45ed8e12038f`
**Scope:** The vendor Cloud *Settings* slice only; not the entire Skills page, skill preload, or complete M8 release gate.

## Implemented and preserved

- Removed the unsupported **Share Skills** Settings navigation group, search catalog, renderer, and deep-link target. Its Cloud account sign-in, vendor publishing permission, link-management information, and unusable controls no longer appear in Settings.
- Preserved `showSkillsButton`, its existing persisted default and update path, and the local Skills sidebar shortcut. The switch now lives in **General → Navigation**, with general Settings search indexing and a working interactive toggle.
- Redirected the legacy post-publish **Manage links** action to the existing Skills page's shared-links view instead of the deleted Settings target. This path is not a supported Cloud operation in Ash; the entire surviving publishing/link UI will be audited separately.
- Deleted only the upstream `ShareSkillsSettingsPane.tsx` and `share-skills-settings-search.ts` files, recording their original SHA-256 entries in `docs/provenance/ash-exclusions.json`. No provider-native skills, local files, MCP configuration, credentials, or runtime sessions were touched.

## Verification

- **Focused renderer tests:** `node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --pool=forks --maxWorkers=1 --no-file-parallelism src/renderer/src/components/settings/general/ash-skills-shortcut-settings.test.tsx src/renderer/src/app-shell/ash-excluded-orca-cloud-settings.test.tsx src/renderer/src/app-shell/ash-excluded-automation-entrypoints.test.tsx` — **3 suites / 11 tests passed**. New coverage checks the absent nav/search/deep link, preserved General search catalog, and both directions of the actual React switch.
- **Full TypeScript:** `pnpm run typecheck` — **passed**.
- **Changed-code quality:** `pnpm run check:code-quality:changed` — **passed**, zero new findings across six changed code files.
- **Formatting:** `pnpm exec oxfmt --check` for edited code and test — **passed**.
- **Source provenance:** verifier **passed**: 33,506 pinned Orca source entries, 377 Ash source adaptations, 8,405 documented removals, unchanged MIT license hash `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- **Electron source bundle:** `pnpm run build:electron-vite` — **passed**, including sandbox preload verification and 255 renderer chunks. Existing chunk size and ineffective dynamic import warnings remain.

The final Git commit/push and exact GitHub CI result must be separately confirmed after those operations. No new native GUI or packaged AppImage test was performed for this particular Settings slice. Passing unit tests and source bundle builds do not imply full Linux/Windows/macOS packaging acceptance.

## Remaining M8 boundary

The main Skills page still advertises **Share skills**, **Install from link**, **Shared links**, and **Manage installs** despite the removal of Cloud skill IPC backends. Preload skill sharing and managed-install methods and related runtime/CLI service types also remain. Remove those surfaces in a separate audited dependency slice, keeping working provider-native skill discovery and local skill management. Continue to distinguish approved native provider skills/MCP from excluded first-party Cloud distribution.
