# M8: retire public vendor Cloud skill publishing routes

**Date:** 2026-11-11

**Base:** `main` at `9c0ac89431bb86f4b7896fa5e2655574888a97b8`

**Scope:** live runtime RPC and CLI entrypoints for *publishing* skills to an Orca vendor Cloud account. This checkpoint does not delete the remaining internal Cloud service, generated RPC schemas, or the separate install/transfer RPC methods; they need a distinct caller/compatibility audit.

## Changes and rationale

- Removed the active `skills.share` RPC registration from `src/main/runtime/rpc/methods/skills.ts`. Previously it could discover local skills and call the Cloud publisher if an old account/permission flag enabled it. The runtime still retains `skills.discover`, `skills.previewDelete`, `skills.delete`, and bundled-skill plan/update methods without changes.
- Removed `skills share` from CLI command specifications and dispatch. The retained `skills installed` command has a dedicated native-discovery handler and continues to list skill names/IDs without exposing paths, publishing contents, or needing a vendor Cloud account. CLI `skills list`, `get`, `install`, and `update` registrations stay unchanged.
- Kept the historical `skill-publishing` marker recognized by the bundled guide filter, but never added to the enabled capability set. That hides previously bundled `skills share` guidance even if old settings report `agentSkillSharingEnabled: true`, while leaving separate artifact-publication guidance subject to its existing permission gate. The generated bundled guide table is not edited manually.
- Replaced the old Cloud `skill-sharing.ts` CLI handler and publisher test source files with `skill-installed.ts` and focused installed-skill tests. The removed upstream file paths and original SHA-256 values are recorded in `docs/provenance/ash-exclusions.json`.
- Added CLI command-registration exclusion coverage and changed the old RPC publishing success tests into a missing-method regression. The Foundation CI workflow now executes the dedicated CLI, guide-gating, and RPC tests for this boundary.

## Observed local evidence

- Focused/adjacent tests: **7 Vitest suites / 33 tests passed**, including provider-native discovery, CLI installed skills, command registration, guide gating, and the runtime skill methods.
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed** with zero new findings across eight changed code files.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification. 255 renderer chunks, 7,836 KB minified; existing large-chunk and ineffective dynamic-import warnings remain.
- Provenance verifier: **passed** with 33,506 pinned upstream entries, 394 source adaptations, **8,452 documented removals**, original root MIT license hash `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.

## Unverified or out of scope

The runtime Cloud publisher implementation, remaining `skills.install` / upload / managed-install RPC methods, legacy global settings, generated RPC schema catalog, and internal skill Cloud contracts still exist. A removed public `skills.share` handler is **not** proof that all vendor Cloud service code or other network entrypoints are gone. Provider-native skill discovery and update contracts must be preserved. A separate native skill-delete IPC acceptance test is still required.

No new live Linux desktop GUI, AppImage packaging, Windows/macOS native build, or true provider skill-install/delete transaction was executed for this checkpoint. Final Git integration and GitHub CI require their own observed results.
