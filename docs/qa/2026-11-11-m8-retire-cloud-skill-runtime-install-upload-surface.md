# M8 — retire the live Cloud skill install/upload runtime surface

**Date:** 2026-11-11

**Base:** `main` at `f8a43a0c1bdf77dfa7d56a40fa8d7349508e9f6f`

**Previous CI:** [Foundation run 43049978584](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43049978584) completed **success** before this checkpoint.

**Pinned source:** Orca `55697aec91390357540103f49991458f756b41cc`, root MIT license retained.

## Verified runtime reachability and change

Previous M8 checkpoints retired vendor Cloud skill sharing and installation/upload from the active RPC, CLI, preload and renderer surfaces. However, the runtime constructor still called `installRuntimeSkillCommandSurface` on an inherited `RuntimeSkillCommands` class, whose old `RuntimeSkillInstallQueries` and `RuntimeSkillInstallCommands` bases bound Cloud-managed install, remote transfer, upload-session begin/append/commit/cancel, managed-install removal, install progress and cancellation methods onto the live `OrcaRuntimeService` object. There were no production callers of these unsupported methods beyond their own inherited class chain and now-retired public routes.

- Replaced the inherited command class with a direct `RuntimeSkillCommands` that provides only native provider-root discovery, plus local bundled-skill plan, execution, and automatic update. The existing bundled services and installed-provider root resolution are reused without rewriting them.
- Narrowed `RuntimeSkillCommandSurface` to the four supported methods and removed obsolete Cloud install/upload types from that contract. Removed the unused runtime-host `isPackaged` wiring which was required only by the retired network download handlers.
- Removed `runtime-skill-install-commands.ts` and `runtime-skill-install-queries.ts`. Their original SHA-256 values and exclusion reasons are recorded in `docs/provenance/ash-exclusions.json`.
- Removed the now-inapplicable main-process `disposeSkillUploadSessions` teardown and its deadline bucket. The upload-session object had been initialized lazily only by the retired begin/install paths and had no remaining registered caller. Updated the pending-writer quit test fixtures, retaining all independent shutdown and final-store safety gates.
- Added `ash-retired-cloud-skill-runtime-surface.test.ts` to check **actual bound runtime instance keys** (not merely the RPC table), exclude fourteen retired Cloud methods, and ensure startup recovery and local delete recovery source remain present. Updated prior M8 regression tests which had still expected old live upload disposal. Both the new runtime regression and the quit deadline test are included in Foundation CI.

## Preservation and non-goals

The retained local bundled-skill service **still waits for `skillTransactionRecovery`**, and production startup still performs recovery of historical install, placement, removal, and delete journals. Native provider-skill discovery, desktop delete IPC, MCP and the user's existing provider/account configuration were not modified. Shared install filesystem, error classification, package download helpers, recovery journals and the legacy upload staging implementation remain in source for a later independent data retention and provenance review.

**No historical `skill-installs/remote-uploads-v2` folders, staged archives, settings, provider homes, Git repositories, or other user's files were deleted or migrated.** Removing an unused cleanup hook is not evidence that existing historical upload staging is automatically cleaned; any future migration/cleanup must be separately authorized and tested under the applicable data-preservation policy.

## Local verification

- Focused runtime/quit/deletion regression selection: **6 Vitest suites, 27/27 tests passed**.
- The **exact** Foundation `Test excluded renderer startup capability gates` step, executed locally with `CI=1` and the CI heap limit: **26 suites, 85/85 tests passed**.
- The **exact** Foundation `Test retained IPC registrations` step, including quit deadlines and real temporary-folder skill deletion: **25 suites, 80/80 tests passed**.
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings.
- `pnpm run verify:rpc-params-catalog`: **passed** (unchanged live RPC methods).
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification. Build reported **255** renderer chunks, **7,836.0 KB** minified. Existing large-chunk and ineffective dynamic import warnings remain.
- Pinned-source verifier: **passed**, **33,506** upstream records, **399** Ash adaptations, **8,470** upstream exclusions; original MIT root license SHA-256 remains `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

**Not tested or accepted:** no real packaged AppImage or graphical Skills-page clickthrough, no Windows/WSL execution, and no migration or cleanup of historical staging data. Commit/push and the successor GitHub Actions CI result must be independently observed; passing local checks must not be described as the new CI passing.
