# M8: restore desktop-native skill deletion IPC and verify a real disposable transaction

**Date:** 2026-11-11

**Base:** `main` at `d2173fcd36623bf5c8d5b66d4c2f5fa980e3df8f`

**Previous CI:** [Foundation run 43032103788](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43032103788) completed **success** before this checkpoint.

## Observed defect and narrowly scoped fix

The retained Skills page's `useSkillDeleteFlow` called the local desktop preload methods `window.api.skills.previewDelete` and `window.api.skills.delete`. The preload forwarded these to `skills:previewDelete` and `skills:delete`, but production main-process readiness registered only `skills:discover`. The shared runtime RPCs `skills.previewDelete` and `skills.delete` were functional for that separate transport; they did **not** register desktop IPC handlers. This left the visible local delete affordance nonfunctional while the preload advertised `deleteSupported() === true`.

`src/main/ipc/skill-delete/handlers.ts` already implemented the missing pair of trusted-main-window IPC registrations with strict `SkillDeleteRequestSchema` validation, host-owned discovery target resolution, provider-root override resolution, and the existing transaction service. Production startup now calls `registerSkillDeleteIpcHandlers(store, runtime)` immediately after provider-native discovery registration. No new delete algorithm, authorization bypass, account mutation, or external vendor service was introduced. The separate remote runtime skill RPCs were not changed.

## Functional test evidence

Added `src/main/ipc/skill-delete/ash-native-delete-ipc-transaction.test.ts` with a real native filesystem and the production discovery/delete handlers. Every test creates an isolated temporary HOME and userData directory, registers trusted-window-only IPC handlers, and removes only those temporary fixtures. The following cases passed:

- Discover two temp skills under an isolated `.agents/skills`, preview deletion of one, assert the preview is non-mutating, execute its staged deletion, and refresh native discovery. The selected skill disappears and its sibling remains intact.
- Refuse requests from a different `webContents` sender; reject extra untrusted request fields at the strict IPC boundary without mutating the skill.
- Block a deletion when the observed `SKILL.md` mtime changes after discovery; skip a requested skill path outside host-authorized discovery roots. Both files remain present.

Updated the existing startup readiness regression to assert the deletion registrar is invoked. Updated the Cloud-handler exclusion regression to check that the retained deletion IPC is registered, requests are schema-validated, and the existing trusted-window wrapper remains in use. Added the transaction and startup tests to the Foundation **retained IPC registrations** step (not to a Cloud-only success path).

## Actual local checks

- Full retained-IPC Foundation step, executed locally with CI settings: **24 suites, 73/73 tests passed**.
- Full Foundation Cloud/UI exclusion step, executed locally with CI settings: **25 suites, 83/83 tests passed**.
- Repeated focused set after recovering a temporarily unavailable workspace connection: **5 suites, 10/10 tests passed**.
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings after correcting new-test assertions/import formatting.
- `pnpm run verify:rpc-params-catalog`: **passed**.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification; 255 renderer chunks / 7,836.0 KB minified. Existing large-chunk and ineffective dynamic-import warnings remain.
- Provenance verifier: **passed**, 33,506 pinned Orca entries, 399 Ash adaptations, 8,468 upstream exclusions, root MIT license hash `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.

## Limitations and next acceptance work

This is a **real on-disk transaction exercised through the desktop main-process IPC handlers under Vitest**, not a visual Electron click-through or a packaged-application test. No real user skill folder was deleted, no Windows/WSL transaction was exercised, and no GUI, AppImage, or native Windows/macOS smoke test was performed. The retained upload staging and recovery/shutdown lifetime still require a separate audit. Final Git integration and the new GitHub CI result must be observed separately.
