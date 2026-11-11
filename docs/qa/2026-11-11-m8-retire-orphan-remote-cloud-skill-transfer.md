# M8 — retire dormant Orca Cloud skill grant and remote-transfer modules

**Date:** 2026-11-11

**Base:** `main` at `6bdcf174891b16f310c7760e392578657b07a297`

**Previous CI:** [Foundation run 43029395343](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43029395343), completed **success** before this slice

**Pinned source:** `stablyai/orca` at `55697aec91390357540103f49991458f756b41cc`; MIT license preserved.

## Audit and change boundary

The prior M8 slices detached the Cloud publishing and shared-skill installation/download RPCs. A fresh static TypeScript import graph and explicit caller search confirmed that the remaining Cloud grant recipient and paired-runtime transfer services have no active production entrypoint. Nine upstream-derived source modules were removed from `src/main/skills/`:

- `skill-cloud-grant-installation.ts`
- `skill-cloud-grant-version.ts`
- `skill-cloud-install-target.ts`
- `skill-remote-install-service.ts`
- `skill-client-mediated-transfer.ts`
- `skill-install-progress-polling.ts`
- `skill-transfer-rpc-retry.ts`
- `skill-runtime-capability.ts`
- `skill-remote-install-cancellation.ts`

Each original file path, pinned SHA-256, and individual exclusion rationale was added to `docs/provenance/ash-exclusions.json`. No application feature was replaced by an unverified Cloud stub; the unsupported remote-vendor skill distribution paths remain excluded from the active RPC and CLI registries.

**Deliberately retained after tracing actual consumers:** `skill-package-download-availability.ts` is required by the local `skill-package-download.ts`, `skill-bundle-observability-summary.ts` is used by `skill-operation-observability.ts`, and `skill-cloud-request-error.ts` is used by shared install failure classification. Despite their names or legacy history, these remain dependencies of retained code and were not deleted. Provider-native discovery, local bundled-skill maintenance, and MCP were untouched.

Startup `recoverPendingSkillTransactions(...)` still runs; the bundled local-skill path awaits the recovery gate. `RuntimeSkillInstallCommands` still owns `SkillUploadSessionService` and `disposeSkillUploadSessions()`, and main-process explicit shutdown still awaits disposal. Those retained paths may require a separate data retention and cleanup audit; this checkpoint does **not** delete or migrate any existing staged uploads, user skill folders, provider accounts, credentials, or local runtime sessions.

## Verification observed

- Focused related tests: **5 Vitest suites / 22 tests passed**.
- Exact Foundation `Test excluded renderer startup capability gates` step, extracted from current `.github/workflows/foundation.yml` and executed in CI mode: **25 suites / 83 tests passed**. The new `ash-excluded-remote-cloud-skill-transfer.test.ts` runs in that workflow and asserts source exclusion and retention of local install/recovery dependencies.
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, **zero new findings** in the changed test code.
- `pnpm run verify:rpc-params-catalog`: **passed**.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification; **255 renderer chunks / 7,836.0 KB minified**. Existing oversized-chunk and ineffective dynamic-import warnings remain.
- Provenance verification: **passed**, with **33,506** upstream source records, **399** Ash source adaptations, **8,468** documented upstream removals, and original MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` unchanged.

**Scope limitation:** Code reachability and source builds do not prove real local skill deletion, managed skill recovery, persisted runtime survival, GUI behavior, AppImage packaging, or Windows/macOS support. No real native GUI, packaged artifact, user-owned skill mutation, or desktop shutdown transaction was performed here. The remaining internal upload staging and installation code require separate review before removal. Final Git push and new GitHub CI outcome must be independently observed.
