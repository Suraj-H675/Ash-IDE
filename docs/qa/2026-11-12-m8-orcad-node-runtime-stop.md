# M8 — Plain-Node runtime stop and persistent PTY acceptance

**Date:** 2026-11-12 (Asia/Kolkata)
**Scope:** repair the independently packaged `orcad` runtime's authenticated stop command without weakening the no-Electron server build guard. This is not complete M8 exclusion or full desktop-release acceptance.

## Failure and ownership boundary

After removing excluded Linear SDK and mobile-web artifacts in Ash `48e85723`, `pnpm run build:orcad` failed because `src/main/runtime/rpc/methods/ash-runtime-control.ts` dynamically imported Electron for `runtime.stop`. Unlike the Electron desktop runtime, `orcad` runs under plain Node and its build intentionally rejects every imported Electron module.

The accepted design routes the already-confirmed, `host-admin`-only, expected-runtime-ID-fenced `runtime.stop` RPC through `AppEnvironment.requestRuntimeStop`. The desktop adapter schedules `app.quit()` (graceful) or `app.exit(0)` (force). The Node adapter schedules its existing installed `SIGTERM` shutdown handler (graceful) or `process.exit(0)` (force); it does not invoke Electron and does not intentionally stop the separate PTY daemon. The Node graceful adapter refuses admission before any shutdown signal listener exists. RPC handlers continue returning `stopping` only after the host accepts the request. Source authority: pinned Orca `55697aec91390357540103f49991458f756b41cc`, with Ash modifications tracked in `docs/provenance/ash-modifications.json`; upstream MIT notice retained.

## Verification

- `pnpm exec vitest run src/main/runtime/rpc/methods/ash-runtime-control.test.ts src/main/runtime/rpc/methods/ash-runtime-methods.test.ts src/cli/handlers/runtime.test.ts --reporter=dot`: **3 suites, 11/11 PASS**. Checks mismatched runtime-incarnation refusal, both host stop modes, host admission refusal, CLI confirmation and active method surface.
- `pnpm run build:orcad`: **PASS**, 13.02 MB bundle, 8,354 input modules, zero Electron and `node:sqlite` imports; bundled plain-Node smoke/load checks passed. Existing package metadata `MODULE_TYPELESS_PACKAGE_JSON` warnings are informational.
- `pnpm run typecheck`: **PASS**, including workspace package builds and project checks.
- `pnpm run build:desktop:assets`: **PASS**, including Electron main/preload/renderer, CLI closure verification and sandbox preload. Existing large-chunk/ineffective-dynamic-import warnings remain.
- `node config/scripts/provenance/verify-source-ledger.mjs --write-modifications` followed by verification: **PASS**, 33,506 upstream file records, 417 current Ash adaptations, 8,479 documented removals, original pinned MIT license preserved.
- `pnpm exec oxfmt --check` and `pnpm exec oxlint` on changed source/test files: **PASS** (zero lint warnings/errors).
- `node config/scripts/runtime-verification/daemon-lifecycle/verify-ash-orcad-local-runtime-stop.mjs`: **PASS** on Linux with packaged Node 24.22.1 and built Ash CLI, including the final run with a sanitized subprocess environment (no inherited provider tokens/account settings). Uses fresh `/var/tmp/ash-orcad-local.*` profile, home, project and credentials, loopback-only WebSocket plus authenticated private local socket, no remote pairing. Verifies real `ash_runtime_ready`, CLI status against runtime ID, original-folder registration, a real `sleep 180` PTY, and identical PTY handle/PID/start-time across graceful runtime stop, process exit, and a second runtime with a **different** runtime ID and the **same** daemon PID. An explicit `terminal-daemon stop --yes` then kills the PTY and daemon. The test waits (bounded) for detached daemon termination, exits the second runtime cleanly, and deletes the test profile, home, project and local credentials. Only diagnostic stdout/stderr files remain, with no private user profile touched.
- Expanded eight-suite regression: **70/71 PASS, one known legacy failure** in `runtime-rpc-request-authorization.test.ts` (`stamps the authenticated device scope onto status.get for WebSocket clients`), which expects an excluded mobile-pairing token to remain valid. The identical test **also fails on untouched `main` at `48e85723`** (1 fail, 8 pass in that suite). Neither production authorization nor the obsolete test was weakened to hide the failure. The separately executed **seven-suite applicable regression is 62/62 PASS**.
- The previous `runtime-serve-terminal-smoke.mjs --target orcad` is **not a valid Ash gate**: it expects the former `orca_server_ready` remote-pairing JSON which Ash intentionally does not publish. It timed out after 120 s despite the server being healthy. This new smoke instead exercises the actual Ash local protocol; restoring pairing to satisfy the obsolete harness is explicitly excluded.
- Final post-integration tests and GitHub CI must be verified separately; no pre-merge success implies that CI is green.

## Remaining scope

Node graceful shutdown with real PTY persistence has been exercised; GUI/Electron native quit under a real Wayland window, Mac/Windows behavior, real provider continuity and force-stop semantics require their respective separate gates. Do not treat this isolated server smoke as validation of those broader workflows. M8 still needs vertical removal of remaining excluded legacy Jira/Linear, mobile and cloud source surfaces.
