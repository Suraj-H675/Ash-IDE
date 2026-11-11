# M8 — retire orphan Cloud skill-upload services without touching historical staging

**Date:** 2026-11-11

**Base:** `main` at `45a5b339748585b8b6d0a59b8aed5118028cbebb`

**Previous CI:** [Foundation run 43053962379](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43053962379), completed **success** before this checkpoint.

**Pinned Orca reference:** `stablyai/orca` `55697aec91390357540103f49991458f756b41cc`, with independent Ash history and original MIT license preserved.

## Dependency audit and source boundary

The prior M8 checkpoint removed the Cloud skill-install and upload command/query classes from the live local runtime. In this checkpoint, `rg`-based production caller tracing of the seven remaining `src/main/skills/skill-upload-*.ts` modules found only mutual references inside the retired upload-service tree. In particular, `skill-upload-session-service.ts` is no longer instantiated by an active RPC, IPC, startup, daemon, shutdown, or native bundled-skill entrypoint. Its only prior activation was lazy on the deleted install/upload runtime methods.

Removed the following unmounted Orca modules from Ash source:

- `skill-upload-archive-hash.ts`
- `skill-upload-operation-lifecycle.ts`
- `skill-upload-retained-paths.ts`
- `skill-upload-session-record.ts`
- `skill-upload-session-service-options.ts`
- `skill-upload-session-service.ts`
- `skill-upload-staging-ownership.ts`

Each upstream file path, original pinned SHA-256 and deletion reason is recorded separately in `docs/provenance/ash-exclusions.json`. No generated contract, provider-native skill configuration, installed bundle, or recovery journal implementation was removed. Previous Cloud capability/endpoint retirement remains in place.

## User-data preservation and recovery behavior

The historical staging directory name is **`skill-installs/remote-uploads-v2`**, with `owner-<pid>-<uuid>` subdirectories and staged `.tar.gz` files. Unlike the old uploader, the retained startup recovery function `recoverPendingSkillTransactions` only selects known installation, removal, placement, deletion journal directories, orphaned extraction paths and installer locks. It does not scan or clean remote upload staging.

Added `ash-retired-upload-staging-preservation.test.ts` to exercise the **real** recovery function against a temporary Ash-profile fixture containing two historical owner directories, opaque partial and complete archive bytes, and a sibling readme. Tests prove the bytes and directory contents survive recovery; they also create an invalid journal, verify recovery reports its rejection, and confirm the old archives remain untouched. An additional test prevents reintroducing any of the seven dead implementation files. The regression is included in the actual Foundation CI exclusion step. Updated the prior live runtime surface regression to assert the orphan staging-ownership implementation is absent rather than present.

**No existing Ash user-profile folders were inspected, read, deleted, migrated, or modified.** In particular, this change does **not** claim that historical archive data has been automatically cleaned or that a safe migration exists. If a future product decision requires data cleanup, it must have its own bounded audit, ownership rules and explicit user authorization before any destructive action.

## Local verification observed

- Focused related skill runtime, local deletion, Cloud exclusion and historical staging tests: **5 Vitest suites, 12/12 tests passed**.
- Exact Foundation `Test excluded renderer startup capability gates` CI step, extracted from current workflow and executed with `CI=1`: **27 suites, 88/88 tests passed**.
- Full `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings.
- `pnpm run verify:rpc-params-catalog`: **passed**.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification. The build emitted **255 renderer chunks / 7,836.0 KB minified**, with pre-existing large-chunk and ineffective dynamic-import warnings.
- Provenance verifier: **passed**, **33,506** pinned upstream source records, **399** Ash adaptations, **8,477** documented upstream exclusions, unchanged root MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Acceptance limits

Passing Node integration tests on disposable files is not a native Electron GUI, packaged AppImage, or Windows/WSL test. No real historical user-data directory was scanned, and no recovery transaction with actual user data was performed. The approved Linux Wayland/X11 packaged-app verification, persistent runtime, PTY/agent, and GUI workflows remain separate acceptance gates. Commit/push and successor GitHub Actions CI outcome are reported only when observed.
