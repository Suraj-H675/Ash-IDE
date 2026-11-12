# M8 — Remove Jira/Linear application connector preload surfaces

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean `main` at `58a46939c98ab85d89d3b910a43246c4c1a7fa0b`, with [GitHub CI 43186792707](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43186792707) successful. Feature branch `feat/m8-exclude-task-tracker-preload` uses its own isolated Git worktree.

## Scope and acceptance boundary

Jira/Linear application connectors are excluded by the Ash capability matrix. Their Main IPC registrars were already unreachable from desktop startup, and the active renderer status path was already gated off, but Electron's trusted preload still unconditionally published `window.api.jira` and `window.api.linear` with methods invoking unregistered `jira:*` and `linear:*` IPC channels. This was a real privileged-exposure and ghost-API defect even though clicking it would normally fail.

Removed both upstream preload bridge files, their imports and properties in the desktop preload entry, and their types from the public `PreloadApi` contract. The 55 local bridge references in 11 archived renderer runtime-client modules now use explicit, typed fail-closed guards that throw before accessing any privileged IPC. No synthetic success, destructive data migration, or credential cleanup is performed. The old browser/web-client preload also drops both namespaces; its generic fallback proxy now explicitly returns `undefined` instead of fabricating a Jira/Linear callable/default-success response. Removed the unused upstream web Jira RPC adapter.

Preserved independent `window.api.gh`, `.gl`, Git, PTY, runtime, browser and native-chat interfaces, including ordinary Git-over-SSH and provider-native tools. Historical Jira/Linear data, issue schemas and migration helpers were **not** deleted. Further legacy runtime/client sources remain and require their own M8 audit; this is not full M8 removal.

## Evidence

- Full project TypeScript check: **PASS** after removing archived web-client typing dependencies. The first attempt correctly found two web-client type references; they were removed rather than restoring Jira/Linear to the desktop contract.
- New `legacy-task-tracker-preload.test.ts`: **4/4 PASS**. Checks no desktop bridge files, no exposed preload imports/properties, failure of both legacy local guard functions, no fabricated web fallback, no retained direct `window.api.jira/linear` references in the archived local renderer clients, and retention of GitHub/GitLab preload names.
- `pnpm run build:desktop:assets`: **PASS**, including Electron main/preload/renderer, CLI closure and sandbox preload verification. Built `out/preload/index.js` has **none** of the `jira:connect`, `jira:status`, `jiraApi`, `linear:connect`, `linear:status` or `linearApi` markers. Retained `git:status`, `pty:spawn` and `runtime:subscribe` remain. Existing oversized-chunk and ineffective-dynamic-import warnings are unchanged.
- Real **native Linux Wayland** smoke: **PASS** with a private virtual KWin compositor, separate DBus session, disposable HOME/XDG/Codex/Claude/GitHub CLI settings and Ash dev `userData`, and an ephemeral CDP port. The built source desktop displayed **Ash IDE**, document readyState `complete`, both `jira` and `linear` absent (including direct property reads), and GitHub, GitLab, PTY, runtime, native chat and browser preload APIs present. Verified `terminal-daemon stop --yes` and `runtime stop --yes` each returned a successful authenticated local receipt and a final `/proc` audit found **zero** processes owned by that private test HOME.
- Native harness refinement: the first smoke passed renderer assertions but the diagnostic cleanup looked under the wrong profile path; a follow-up also tried an ineffective `ORCA_DEV_USER_DATA_PATH` variable. Both early attempts were explicitly **not** accepted as clean-shutdown evidence. Their separate daemon processes were retired using fixture-specific PID records, Linux process-incarnation checks and `--pid-record` path verification. The final successful run used the actual source-Electron override `ASH_DEV_USER_DATA_PATH`, then verified real CLI cleanup receipts and no leftover owned processes. No real user profile or provider credentials were used.
- Pinned-source ledger: `docs/provenance/ash-exclusions.json` records the exact upstream SHA-256 for the three deleted files; `ash-modifications.json` records changed upstream source hashes. Original pinned Orca commit `55697aec91390357540103f49991458f756b41cc` and MIT license retained.
- Adjacent `ash-excluded-startup-gates.test.tsx`: **not green on the feature or unchanged base**. Its Vite runner fails before collecting tests while resolving existing `@/lib/bundled-skill-target` alias (even though the source file exists). Do not count it as a passing regression, weaken it, or misattribute the identical baseline resolution error to this change.

## Remaining verification

The Linux evidence is an isolated **source Electron build**, not the packaged AppImage, an X11 run, macOS/Windows run, real Jira/Linear network call, or general release approval. The separate `orcad` Node build, retained local/agent regressions, final `main` post-integration tests and matching GitHub CI must be independently checked before this slice is accepted into `main`.
