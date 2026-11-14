# M8 / EX-02 — Retire managed-SSH agent preflight transports

**Date:** 2026-11-14 (Asia/Kolkata). **Base `main`:** `896aeba03f556f2b4c04d5274073bd50ef726d7f`, GitHub Actions run `43541040419` succeeded. **Feature commit:** `106a25171c11bcc80845af51eb7f099511d83463`. **Isolated worktree:** `/home/suraj/.devspace/worktrees/Ash-IDE-ae925aa8`, branch `fix/m8-retire-remote-preflight-endpoints`.

## Changes

- Removed the `preflight:detectRemoteAgents` and `preflight:detectRemoteWindowsTerminalCapabilities` desktop IPC handlers, the corresponding authenticated runtime RPC method registrations, native preload and browser API exposure, and their request schemas. Regenerated the RPC parameter catalog from the actual registry.
- Eliminated the live renderer's nested-SSH inventory fallback. A historical remote-agent inventory request now fails closed with an empty list and failed outcome rather than accessing an SSH host. A historical SSH terminal-capability request also returns an unavailable result without contacting desktop or RPC transports.
- Kept **local** preflight agent discovery and refresh, local Windows/WSL terminal capability probes, original-folder-first workspace behavior and the source-compatible historical state contract. Corrected the native preload `preflight.check` return type, which incorrectly still advertised a Linear status absent from the actual runtime result.
- Deleted the orphaned managed-SSH Windows terminal-capability helper and recorded its original SHA-256 in the pinned Orca source exclusion manifest. No user workspace, saved connection, account or credential was accessed or erased.

## Verification

- **Red first:** 3 new negative assertions initially failed against registered remote IPC/preload/RPC methods.
- **Tests:** 19/19 targeted tests across 5 files passed. Expanded regression suite: **34 passed and 2 Windows-only tests skipped**, 10 passing files and 1 skipped file (11 files total). This covered local/WSL preflight RPC, selected execution targets, retired Jira transports, nested-SSH refusal, and renderer client boundaries.
- Full repository `pnpm run typecheck` **PASS**; changed-file Oxfmt and Oxlint **PASS**; RPC parameter catalog generation `--check` **PASS**; `git diff --check` **PASS**.
- Provenance: **33,506 original source records, 573 current Ash adaptations, 8,560 documented exclusions**, original Orca MIT license retained.
- `pnpm run build:desktop:assets` **PASS**: 257 renderer chunks, 7,799.7 KB minified boot graph; sandbox preload and 1,224 CLI closure files / three public commands verified.
- `pnpm run build:orcad` **PASS**: 12.78 MB and 8,144 modules with no Electron or `node:sqlite` imports; bundled Node 24.22.1 referenced.
- Native build / Electron runtime preparation **PASS**. Fresh x64 Linux AppImage: `dist/ash-ide-linux.AppImage`, **224,371,090 bytes**; SHA-256 **`84723e40e9588eaba66c82ae9bc6d986b1bcc473ec983dca317630a483ab939f`**. Package verification checked **5,199 ASAR entries**, 15 native binaries at the Ubuntu 20.04 glibc floor, packaged daemon entrypoint, bundled Node PTY, and two plugin-resource bundles.
- Output scan of built main, preload, renderer and orcad for either removed remote-preflight IPC/RPC method name: **none found**.
- **Wayland AppImage close/reopen lifecycle PASS:** app PID `20543`, runtime ID `ac233855-b7d1-40e1-868d-3ebb595fd7c5`, terminal handle `term_90cd0628-2763-441b-af61-f4f3d430ba65`, terminal PID `21191` survived last-window closure and reopening. Test-owned daemon/runtime stopped; private fixture logs `/var/tmp/ashwl.tuYIcD`.

## Limits

- This verifies only the managed-SSH _agent preflight_ boundary. Other inherited remote-development IPC, RPC, renderer modules, and deprecated features require separate whole-package audits; it is **not** final EX-02 or M8 acceptance.
- The additional private X11 smoke attempt was not completed because the test harness rejected the temporary script with a disk-quota error; do not count this as X11 evidence. Windows/macOS native tests, authenticated coding agents, visual parity, update deferral and rollback remain separate gates.
- Tests used synthetic temporary fixtures, not real Jira/Linear/SSH accounts or existing user repositories. The final integrated GitHub Actions result must be observed after push.
