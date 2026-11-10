# M8 — retire phone RPC routing tables and fail closed at dispatcher admission

**Date:** 2026-11-10 (Asia/Kolkata)

**Branch:** `feat/m8-retire-mobile-rpc-routing-policy`, based on accepted `main` `fdd4d1250fdf2eb39d1bd2b8d7d05e0b5cf45824`.

**Scope:** Incremental desktop-only M8 source and RPC security boundary. Not the complete mobile pairing/source elimination or packaged-release acceptance.

## Implementation

- Removed the obsolete `runtime-rpc-mobile-method-routing.ts`, `runtime-rpc-mobile-method-allowlist.ts`, `runtime-rpc-mobile-agent-session-methods.ts` and `runtime-rpc-mobile-paired-desktop-methods.ts` files. The direct WebSocket forwarding branch was retired in the preceding milestone; these four tables were thereafter read only by inherited mobile-scoped dispatcher and agent-launch authorization.
- `denyRpcMethodForCaller` now returns the same explicit mobile-not-supported denial for **every** mobile or delegated-mobile caller, whether the method is known, unknown, previously allowlisted, or privileged. This prevents method-existence leakage and denies requests at ordinary unary/streaming RPC admission even if a caller bypasses the WebSocket handshake. Existing owner and runtime-paired permission/grant logic remains unchanged.
- Direct agent-launch workspace-target authorization no longer depends on the phone allowlist: it retains the historical isolated handler rule forbidding phone-created folder workspaces, and no longer needs the phone routing table. This isolated helper can still parse legacy worktree/existing targets, but **no authenticated mobile RPC can reach it** because dispatcher admission denies every mobile request. Native/runtime clients retain original launch behavior. Legacy direct replay tests were updated to identify the supported paired runtime-client scope without losing durable idempotency checks.
- Updated obsolete tests that imported the old phone routing lists to validate denial instead. Kept the existing isolated legacy handler tests for attachment read limits, local Jira UI state, mobile bundle parsing and layout command validation; these tests do **not** imply the excluded mobile product RPCs are registered or reachable in Ash.
- Added a dedicated Ash regression suite for removed route-table source, owner versus runtime-paired status, known/unknown/pairing/push phone denial and direct agent-launch rejection; added it to the GitHub foundation test job.
- Recorded the four upstream-derived deleted files and exact original hashes in `docs/provenance/ash-exclusions.json`. No user data, saved device registrations, provider auth, user repositories, Git history or profiles were removed or migrated.

## Verification

- Full TypeScript project check: **PASS**.
- Changed-source Oxfmt and native/type-aware Oxlint with `--deny-warnings`: **PASS**, zero warnings/errors.
- Source provenance: **PASS**, 33,506 pinned upstream Orca records, 352 current Ash source edits, 8,276 documented removals, unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Expanded security, local browser, agent replay, layout, attachment, client UI state and legacy negative-boundary tests: **234/234 PASS across 17 suites** after adding the streaming mobile-denial assertion. The 50-test inherited `agent-launch.test.ts` suite and replay tests passed after preserving isolated direct-handler semantics; the actual authenticated dispatcher still refuses all mobile callers. Existing agent-launch test-fixture warnings about absent optional mobile tab selection remain, without failing those tests.
- Guarded Electron source build: **PASS**, plain-Node daemon entry and sandbox preload verification passed. Renderer boot graph: 255 chunks / 7,836.4 KB minified; inherited ineffective dynamic-import warnings remain.
- Actual Linux/Wayland Electron source desktop smoke using disposable private profile `/tmp/ash-m8-no-mobile-routing-wayland-MdAz5O`: **PASS**. Renderer title `Ash IDE`, DOM complete, preload present; `mobile`, `automations` and `speech` preload APIs absent, while local `pty.spawn`, `nativeChat` and `settings` remained available. HOME/XDG/Codex/Claude/GH/Git global settings redirected to the disposable test profile. Test Electron and three profile-matched helpers were stopped.
- Feature-tip GitHub CI and post-integration `main` verification are separate gates; report only observed results.

## Git and remaining scope

Reused the **same clean implementation worktree** `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward`, switched to a fresh feature branch from verified `main`, preserving previous branches and the 41-worktree inventory. No automatic cleanup of older worktrees (including the independently dirty `m8-speech-integration`) and no force push.

The historical `createMobilePairingOffer` API, mobile pairing IPC module, saved device records/outboxes, relay provider interfaces and dormant cloud/mobile implementation modules still need separate reachability and source-removal review. Local-runtime E2EE/browser client access, browser extensions, PTY/agent workflows, manual Runs and normal Git-over-SSH remain required. AppImage packaging, X11, cross-platform and real-provider acceptance remain open.
