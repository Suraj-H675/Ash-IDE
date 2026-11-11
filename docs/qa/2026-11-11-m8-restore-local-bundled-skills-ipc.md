# M8 — restore retained desktop bundled-skill maintenance IPC

**Date:** 2026-11-11 (Asia/Kolkata)

**Base:** `main` at `d617cd8c8a1f590e3ee3f61bcf52f93772a9ccd0`

**Previous CI:** [Foundation run 43060782397](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43060782397) completed **success** before this work. The repository was clean and synchronized with `origin/main`.

## Verified defect and production change

Ash intentionally retains native provider skill discovery and bundled local skill planning, execution and hash-verified auto-updating. The renderer's `runtime-bundled-skills-client.ts` invoked `window.api.skills.bundledPlan`, `bundledExecute` and `bundledAutoUpdate` for a local desktop target. Preload forwarded these to `skills:bundledPlan`, `skills:bundledExecute` and `skills:bundledAutoUpdate`. Production startup had registered only native discovery and deletion handlers after the earlier Cloud skill-handler retirement. The local UI therefore had no main-process listener for its retained bundled-skill maintenance actions.

- Added `src/main/ipc/bundled-skills.ts` to register only the three retained local bundled-skill IPC methods via the existing `handleMainWindowSkillIpc` trusted-webContents guard.
- Each IPC method uses the **existing strict** shared request schema (`LocalBundledSkillPlanRequestSchema`, `LocalBundledSkillExecuteRequestSchema`, `BundledSkillAutoUpdateRequestSchema`) before invoking the corresponding retained runtime method. Plan defaults to `{}`; execution still requires a valid SHA-256 plan digest. No new installer or filesystem mutation algorithm was introduced.
- Wired `registerLocalBundledSkillIpcHandlers(runtime)` in `initializeReadyRuntimeServices` after native discovery/deletion registration. No Orca Cloud, remote distribution, upload session, account, or shared-install handler was restored.
- Added a three-test IPC suite covering the exact channel set, valid delegate arguments, sender impersonation rejection, and rejection of unknown/malformed Cloud-like or invalid-digest requests before calling the local services. Updated the startup wiring test, Cloud-exclusion source test, and preload regression. Included the new suite in Foundation's **retained IPC registrations** group.

## Locally observed verification

- Focused tests: **5 Vitest suites / 21 of 21 tests passed**.
- Exact Foundation `Test retained IPC registrations` command locally: **26 suites / 83 of 83 tests passed**.
- Exact Foundation `Test excluded renderer startup capability gates` command locally: **27 suites / 89 of 89 tests passed**.
- Full `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings.
- `pnpm run verify:rpc-params-catalog`: **passed** (retained RPCs unchanged).
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification. Renderer boot graph: **255 chunks / 7,836.0 KB minified**. Pre-existing large-chunk and ineffective dynamic-import warnings remain.
- Source ledger: **passed**, **33,506** pinned upstream records, **401** Ash adaptations, **8,477** documented exclusions. Original Orca MIT root license hash unchanged: `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Separate runtime-reconnection probe

An additional isolated source-Electron run under Xvfb/X11 used a newly generated private `/tmp/ash-runtime-reconnect.*` home, XDG directories, runtime directory and Ash profile. At two checkpoints with the GUI process alive, `ash-ide status --json` reported **`runtime.state=ready`, `reachable=true`** and `terminal-daemon status --json` reported **`daemon.verdict=live`** with a stable daemon PID and runtime ID. The authentication metadata `ash-runtime.json` was observed in that isolated profile. No user-owned provider data or repositories were accessed for this probe.

After the test harness terminated the Electron parent via `SIGTERM`, `ash-runtime.json` was absent and the CLI reported `not_running`; the daemon process was still visible. **This does not reproduce a graceful close of the last GUI window**, so it must not be classified as a window-close persistence regression. Earlier source-Wayland evidence in `docs/qa/2026-11-08-m2-claude-native-wayland.md` demonstrated actual graceful window-close/reopen survival of the same runtime, daemon and Claude process in that test fixture. This checkpoint does not reassert those facts for a packaged AppImage. The process-harness cleanup must stop only its isolated test-owned daemon.

## Scope limitations

The IPC tests use a mocked local runtime with strict argument and sender assertions; they do **not** execute a real bundled-skill write, apply an update, or verify a rendered GUI clickthrough. Existing files in provider skill homes were not changed by this checkpoint. Packaged AppImage, live Wayland/X11 installed UI, full PTY continuity and authenticated provider-agent turns still require separate acceptance. Docker's daemon socket remains absent for the required native Wayland clipboard helper build. Final push and successor CI must be observed separately.
