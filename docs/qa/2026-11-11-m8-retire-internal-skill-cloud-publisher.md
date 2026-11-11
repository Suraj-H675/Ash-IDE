# M8: retire the unmounted internal Orca Cloud skill publisher

**Date:** 2026-11-11
**Base commit:** `main` at `69027b0abcfbc52823e2587ef6a3e9eb9e398b6e`
**Previous GitHub CI:** [Foundation run 43026499671](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43026499671) **success**, verified before beginning this slice
**Source pin:** `stablyai/orca` `55697aec91390357540103f49991458f756b41cc`
**Scope:** internal vendor Cloud skill publisher, associated runtime settings projection, and exclusive source dependencies. Not a full M8 or release acceptance.

## Reachability and source modifications

The preceding M8 checkpoints retired `skills.share` from the public runtime RPC and `skills share` from the CLI. A fresh caller audit found no production registration or caller of `RuntimeSkillCommands.setSkillCloudService`, or of its publishing/share-link methods. The only remaining call to `hasSkillCloudService` was a legacy runtime-construction settings availability check. These methods could not provide a supported Ash IDE feature, but retained an Orca Cloud dependency graph.

- Replaced the obsolete skill-publisher command subclass with an empty subclass of `RuntimeSkillInstallQueries`, preserving the inherited provider-root resolution, bundled local-skill maintenance, and existing skill-install/upload lifecycle methods for a separate dependency and shutdown audit.
- Removed Cloud publishing/share-link methods and type dependencies from `RuntimeSkillCommandSurface`, along with the unused `agentSkillSharingEnabled` getter in its host contract and the corresponding constructor argument. This removes a path that would otherwise allow an authenticated vendor Cloud service to be installed onto the runtime command surface.
- Removed the legacy `hasSkillCloudService` availability callback and stopped projecting `agentSkillSharingEnabled` to runtime clients even when an existing profile stores it as true. The unrelated artifact-sharing service gate is unchanged. Updated the regression to verify the retired capability is always absent and cannot be enabled through the client settings schema.
- Deleted **seven** exclusively referenced Orca Cloud publisher files in `src/main/skills/`: `agent-skill-selection.ts`, `skill-share-preparation-service.ts`, `skill-cloud-service.ts`, `skill-cloud-auth.ts`, `skill-cloud-direct-upload.ts`, `skill-cloud-request.ts`, and `skill-cloud-deadline.ts`. Each original source path and upstream SHA-256 has an explicit entry in `docs/provenance/ash-exclusions.json`.
- Added `ash-excluded-internal-skill-cloud.test.ts` to guard the removed source tree and retained local-skill dependencies. Included this test and the runtime settings regression in the Foundation CI exclusion suite. Removed two obsolete publisher-service fixtures from the duplicate-terminal startup test.

## Deliberately preserved

- Provider-native skill discovery, local skill deletion/preview RPC, existing bundled local-skill plan/execute/auto-update, and MCP configurations.
- The **shared** `skill-cloud-request-error.ts` type, still used by `skill-install-operation-error.ts` for legacy error classification; it was not treated as exclusively owned by the publisher.
- Runtime `disposeSkillUploadSessions`, startup transaction recovery, staged upload/remote transfer and managed-install internals. Public vendor Cloud install/upload RPCs were already retired, but this slice does **not** prove all dormant internal installation/transfer code has been removed or all old staged artifacts have been migrated. The startup and shutdown lifecycle needs independent review before further deletion.
- Unrelated artifact sharing implementation; neither its service registration nor existing read-only permission behavior was changed.

## Actual verification

- Focused runtime/startup tests after the seven deletions: **6 Vitest suites / 23 tests passed**, including publisher exclusion, runtime settings, native skill RPC and discovery, Cloud IPC retirement, and duplicate-terminal startup.
- Exact Foundation **`Test excluded renderer startup capability gates`** step, executed locally with `CI=1` and the configured Node heap limit: **24 suites / 81 tests passed**.
- `pnpm run typecheck`: **passed** after removing a stale Cloud-only constructor argument surfaced by the first type-check.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings.
- `pnpm run verify:rpc-params-catalog`: **passed**.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification; **255 renderer chunks / 7,836.0 KB minified**. Existing large-chunk/ineffective dynamic-import warnings remain.
- Source provenance verifier: **passed**, **33,506** upstream file records, **399** adapted Ash source files, **8,459** documented exclusions, unchanged root MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

Final staged diff, Git push, and new GitHub Actions outcome are recorded separately; these local passes are not evidence that a later CI run passed. No live skill-delete transaction, packaged AppImage, Wayland/X11 desktop GUI smoke, or native Windows/macOS smoke was executed in this checkpoint.
