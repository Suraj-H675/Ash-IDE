# M8 — retire Jira/Linear RPC and CLI registry roots

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean, CI-green `main` at `d612a387d00c13ceb25e2b801d064a33bc151752`. GitHub run [43190898585](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43190898585) completed successfully. Isolated feature branch: `feat/m8-exclude-task-tracker-rpc-cli`.

## Verified source boundary

Ash's live `ASH_RPC_METHODS` already blocked `jira.*` and `linear.*`, and the minimal published CLI already omitted the corresponding command roots. However, the broad `ALL_RPC_METHODS` manifest still eagerly imported all three Jira/Linear RPC arrays, including agent-access methods; the broad `COMMAND_SPECS` registry still imported both task-tracker command collections, and `HANDLER_GROUPS` still registered lazy Jira/Linear handler groups. This was excluded source reachable by the broader server/CLI bundles even though the final Ash filters made the methods unavailable.

Removed the three RPC import roots and spreads, the two CLI command-spec import roots and spreads, and the two CLI handler-group imports and entries. Kept the `jira.` and `linear.` negative prefixes in the live Ash RPC filter as defense in depth, in case legacy declarations are accidentally reintroduced later. Retained local `runtime.stop`, PTY, Git, browser, manual orchestration, and all source required for historic issue-reference normalization and data migration. No saved user repositories, Jira/Linear records, credentials or provider accounts were read or modified. This is not complete vertical removal of the dormant Jira/Linear runtime, renderer, schemas or migrations.

## Evidence and remaining constraints

- Red-first regression: both newly added CLI negative tests failed against the original broad registries. Initial RPC test discovery was blocked by the new isolated worktree's not-yet-built `@orca/process-host`; a full workspace typecheck built it, then all applicable tests passed.
- Full `pnpm run typecheck`: **PASS** including workspace package builds.
- Eight-suite relevant Vitest run: **46/46 PASS**, covering the broad RPC registry, CLI spec/handler registry, previously excluded scheduled/cloud commands, runtime stop and the unrelated retained mobile bundle behavior. The test explicitly requires the broad server/CLI registries to be free of Jira/Linear while retaining local Git, PTY, runtime shutdown and manual orchestration.
- `pnpm run build:desktop:assets`: **PASS**, sandbox preload and CLI verification included. Built CLI closure: **1,223 files / 3 commands**, versus **1,244 files / 3 commands** before this slice; this is the observed smaller closure, not a claim that all Jira/Linear source files are deleted. Existing large chunk and ineffective dynamic import warnings are unchanged.
- `pnpm run build:orcad`: **PASS**, **12.99 MB / 8,338 input modules**, compared with the earlier 13.02 MB / 8,354 module build. Existing no-Electron/no-`node:sqlite` import guard still reports **zero forbidden imports**.
- Real packaged standalone Node runtime lifecycle: **PASS** with disposable HOME/project/profile, authenticated CLI, a real live PTY, graceful `runtime.stop`, replacement runtime ID, and the original terminal handle/PID and daemon identity preserved through restart. The test-owned PTY/daemon were explicitly terminated, and private profile/credentials removed.
- Existing `src/cli/specs/cli-command-names-parity.test.ts` remains **FAILED on unchanged baseline `main` and feature**: it expects the `runtime` root to be recognized by a generic redirect helper, which returns `null`. Not changed or counted as passing. The other six suites in the initial expanded seven-suite run passed; the later eight-suite applicable regression passed in full.
- Pinned Orca source remains `55697aec91390357540103f49991458f756b41cc` under MIT. Changed source hashes are tracked in `docs/provenance/ash-modifications.json`; the two command specs, handler groups and three RPC implementation modules remain in the checkout for historical code paths/tests and are not misrepresented as deleted files.

## Remaining acceptance

Full M8 exclusion, removal of dormant connector implementations and runtime facades, Windows/macOS releases and user-signed-in provider integration remain open. Feature checks are separate from integrated-`main` checks and GitHub CI; report each independently.
