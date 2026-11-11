# M8 — retire Orca Cloud skill installation and upload RPC exposure

**Date:** 2026-11-11

**Base:** `main` at `b6dec6b6d50ce67df785f8338dff128faf86aab2` (previous Foundation CI [43023561377](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43023561377) confirmed successful).

**Scope:** authenticated runtime RPC registration, generated shared RPC parameter catalog, and capability advertisement. This is not a source-wide removal of internal Cloud skill services or native application acceptance.

## What changed

- Removed **eleven** Orca Cloud skill distribution/installation RPC handlers from the `SKILL_METHODS` registry: `skills.install`, `skills.installBundle`, `skills.cancelInstall`, `skills.getInstallProgress`, `skills.previewInstall`, `skills.removeInstall`, `skills.listManagedInstalls`, `skills.beginUpload`, `skills.uploadChunk`, `skills.commitUpload`, and `skills.cancelUpload`. The vendor publishing method `skills.share` had been removed in the preceding M8 public-route checkpoint.
- Retained **exactly six** local/provider-native RPCs, with their previous names and implementations: `skills.discover`, `skills.previewDelete`, `skills.delete`, `skills.planBundledOrca`, `skills.executeBundledOrca`, and `skills.autoUpdateBundledOrca`. Provider-native skills and MCP are not part of the removed API surface.
- Regenerated `src/shared/rpc-contract/rpc-params-catalog.generated.ts` from the actual runtime method registry, rather than hand-editing generated source. It now lists only the six retained `skills.*` method names; obsolete Cloud parameter-schema imports and the previously retired `skills.share` entry are absent.
- Removed eight stale Cloud skill capabilities from `SKILL_RUNTIME_CAPABILITIES`: install v1, bundle install v1, cancel install v1, progress v1, result v2, upload v1, management v1, and install providers v1. The constants themselves remain only for legacy internal callers pending a separate audited cleanup; they are **not** announced by `RUNTIME_CAPABILITIES`.
- Adapted existing RPC regression tests to verify the precise retained method list, exclusion of retired methods from the generated catalog, absence of obsolete Cloud capability advertisements, and execution of the retained bundled-skill delegate calls. Tests for Cloud installation success paths were replaced with exclusion tests because that product feature is deliberately removed.
- Updated `docs/provenance/ash-modifications.json` against the original pinned Orca source. No original source file was removed in this slice.

## Local verification performed

- Focused regression suite: **7 Vitest suites / 24 tests passed**, covering native skill RPC, retained Ash RPC exclusion checks, provider-native discovery, prior Cloud IPC/UI exclusions, and CLI publishing exclusion.
- The **exact existing Foundation CI** `Test excluded renderer startup capability gates` command was extracted from `.github/workflows/foundation.yml` and run locally with `CI=1` and the workflow's Node memory setting: **22 suites / 73 tests passed**. This guards against stale tests overlooked by focused selection in an earlier checkpoint.
- `pnpm run verify:rpc-params-catalog`: **passed**. Generated shared schema catalog matches the actual registered RPC methods.
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed** with **zero new findings** across four changed code files.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification. Reported **255** renderer chunks / **7,836.0 KB** minified. Existing chunk-size and ineffective dynamic-import warnings remain.
- Source ledger verifier: **passed**, **33,506** pinned upstream records, **395** Ash adaptations, **8,452** documented upstream exclusions; original MIT license SHA-256 remains `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Not accepted or yet removed

Existing internal Cloud skill services, upload staging/remote transfer utilities, and legacy shared contracts remain in source. Some still contain outbound and filesystem logic; they are not considered removed merely because the public RPC methods are gone. Their production reachability and shutdown/data-retention responsibilities require a subsequent audited boundary. Likewise, bundled local-skill update behavior and native skill deletion *transaction* were not exercised with a real running desktop/backend in this checkpoint.

No new packaged AppImage, Wayland/X11 GUI smoke, live user skill-delete transaction, or Windows/macOS native build was performed. Commit/push and GitHub CI results must be observed separately, not assumed from passing local checks.
