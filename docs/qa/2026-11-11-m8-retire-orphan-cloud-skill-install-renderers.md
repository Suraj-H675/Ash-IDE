# M8 — retire unmounted Orca Cloud skill-install renderer tree

**Date:** 2026-11-11
**Base:** `main` at `161644e3fe4534d5a491a073580b7e132a464a78`
**Upstream source pin:** `stablyai/orca` at `55697aec91390357540103f49991458f756b41cc` (Orca 1.4.214).
**Scope:** one source-removal slice, not M8 release acceptance.

## Reachability audit and changes

The two vendor Cloud install entrypoint components (`SkillInstallDialog.tsx` and `SkillInstallManagementDialog.tsx`) have been unmounted from the active Ash Skills page since the earlier M8 checkpoint. A static import-graph audit across `src/` recursively resolved the source files used by those two entrypoints. The closed Skills-component subtree contained **35** files: **34** were exclusively reachable through those unmounted Cloud dialogs, while `skill-display-labels.ts` is also used by live Skills UI and other retained consumers and therefore **must stay**.

Removed the **34** abandoned Cloud install, bundle-review, managed-install, link-preview, provider-picker-for-Cloud-install, progress, risk-review and ancillary UI/helper modules. See the exact path list in `src/renderer/src/components/skills/ash-excluded-cloud-install-components.test.ts`. Every deleted upstream-derived file retains its pinned original SHA-256 and exclusion reason in `docs/provenance/ash-exclusions.json`.

In `skill-display-labels.ts`, removed only the four now-unused Cloud-only helpers (`shareLinkCountLabel`, `shareSelectionActionLabel`, `installSkillsActionLabel`, `retrySkillsActionLabel`), preserving live skill counts, sources, file counts, filter results and selected-count display. Updated the existing Cloud-publishing regression to check preserved display-label consumers rather than the deliberately removed `SkillPackageChecklist`, and added the install-tree exclusion regression to the Foundation CI workflow.

## Intentionally preserved

- Provider-native skill discovery, refresh, inventory, filters, file reveal/copy, and the existing skill deletion **UI wiring**.
- Skill freshness/update UI and its separate bundled skill-plan runtime APIs; these must be independently assessed before any removal or support claim.
- `skill-display-labels.ts`, required outside the removed import graph by the Skills UI and AI Vault; `skill-bundle-name.ts`, used by the CLI; other user-owned skill files, agent configurations and MCP remain untouched.
- Existing shared skill Cloud contracts, legacy preload compatibility stubs, runtime/CLI vendor service paths, and any remaining unused utility source outside this import closure are **not** accepted as removed. They require a separate dependency and security audit.

## Verification

- **Focused tests:** `7` Vitest suites, **16/16 passed** (install-tree exclusion, Cloud publishing and page exclusions, Settings shortcut, preload/IPC exclusions and provider-native skill discovery).
- **Typecheck:** `pnpm run typecheck` **passed**.
- **Changed-code quality:** `pnpm run check:code-quality:changed` **passed**, no new findings.
- **Source provenance:** verification **passed**, 33,506 pinned upstream records, 389 adapted Ash source hashes, **8,450** documented exclusions; the original root MIT license hash is unchanged (`ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`).
- **Desktop source build:** `pnpm run build:electron-vite` **passed**, including sandbox preload verification and 255 renderer chunks (7,836.0 KB minified). The existing large-chunk and ineffective dynamic-import warnings remain.
- **Final Git integration and GitHub CI:** require independent confirmation; do not infer success from the preceding checks.

This checkpoint did **not** exercise a live Electron Skills-page GUI, actual skill deletion IPC, a packaged Linux AppImage, or Windows/macOS packages. These remain separate acceptance gates.
