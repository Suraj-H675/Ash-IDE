# M8: repair CI after retiring the CLI skill publisher

**Date:** 2026-11-11

**Base branch / commit:** `main` at `183f1e7e898f848e6445d05b632163f707160196`

## Failure and cause

GitHub Actions run [43022061056](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43022061056) **completed with failure**. Its `Source, types, CLI, and desktop bundle` job failed at `Test excluded renderer startup capability gates`, after the previous M8 checkpoint intentionally removed `src/cli/handlers/skill-sharing.ts` and replaced it with the native-only `skill-installed.ts` handler.

The legacy test `src/renderer/src/components/skills/ash-excluded-cloud-install-components.test.ts` still attempted to `readFileSync` the removed `skill-sharing.ts` path. GitHub reported `ENOENT` at line 62; this was an outdated test expectation, not evidence of a production runtime crash. The previous checkpoint's selected local tests did not include that older regression. CI recorded **75 passing tests and one failure** across the full 22-file step.

## Correction

Updated the existing test to inspect `src/cli/handlers/skill-installed.ts`, verifying the retained `skills.discover` RPC call and `skills installed` command. It also verifies that the Cloud `skills.share` publisher is not referenced by this handler and that `skills install` / `skills update` CLI specifications remain present. The removed `skill-sharing.ts` file is now asserted absent rather than read. Retained provider-native skill discovery, local skill display labels, and the separate skill freshness/update path remain under test.

**Only a regression test was edited.** No production source, CLI routes, IPC, runtime, provider accounts, MCP configuration, or user-owned files were changed.

## Local verification

- Extracted and ran the **exact** `Test excluded renderer startup capability gates` shell command from `.github/workflows/foundation.yml` with `CI=1 NODE_OPTIONS=--max-old-space-size=4096`: **22 suites / 76 tests passed**, exit 0.
- `pnpm run typecheck`: **passed**.
- `pnpm run check:code-quality:changed`: **passed**, zero new findings across one edited code file.
- `pnpm exec oxfmt --check` on the edited test: **passed**.
- `node config/scripts/provenance/verify-source-ledger.mjs`: **passed**, 33,506 pinned upstream source records, 394 Ash adaptations, 8,452 documented exclusions; root MIT license SHA-256 unchanged (`ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`).
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **passed**.
- `pnpm run build:electron-vite`: **passed**, including sandbox preload verification, 255 renderer chunks (7,836.0 KB minified). Existing large-chunk / ineffective dynamic-import warnings remain.

Git commit, push and the successor GitHub CI status must be observed and reported separately. No new live GUI, packaged AppImage or native skill deletion transaction was performed in this test-repair checkpoint. Internal Cloud skill installation and upload RPC cleanup remains a distinct audited task.
