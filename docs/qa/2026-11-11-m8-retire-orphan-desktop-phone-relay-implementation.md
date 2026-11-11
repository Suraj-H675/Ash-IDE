# M8 — retire the orphan desktop-to-phone relay forwarding implementation

**Date:** 2026-11-11 (Asia/Kolkata).

**Branch:** `feat/m8-retire-orphan-desktop-phone-relay-implementation`, based on verified `main` `09ad1e747c33aeef112481984d8b064b3cd7fd2e`.

**Classification:** Scoped M8 source removal, not full M8/packaged release acceptance.

## Implementation and reachability

- Removed twelve upstream-derived, now-unreachable files under `src/main/runtime/mobile-desktop-relay/`: `mobile-desktop-relay.ts`, relay link and phone frame rewriting, delegated-phone grant synchronization/cache, mobile-hosted browser forwarding, remote GitHub authority checks, remote browser-tab creation, remote server worktree catalog/on-demand fetching and stream carriers, plus the no-longer-used test-only paired-phone fixture.
- No active production module referenced the forwarding implementation after the previous retirement of pairing offers, mobile relay-provider registration and relay-forwarding dispatch. The **one** outside-directory type dependency on `ServerWorktreeRows` from the retired catalog was redundant: `PairedServerRowsProducer` already implements the relevant methods directly. Removed only that import/implements declaration; kept its behavior, public methods and construction intact.
- **Preserved three still-imported sidebar support modules:** `mobile-desktop-relay-hosts.ts` (type contract), `mobile-relay-host-descriptions.ts`, and `server-worktree-fetch.ts`. The latter two are still used by the desktop paired-server sidebar producer; this removal does not establish that the remaining remote-host catalog is approved Ash functionality.
- Added `ash-retired-phone-relay-implementation.test.ts`, asserting deleted source absence, retained helper presence, inert default sidebar projection and the retained sidebar worktree-host normalization. Registered the test in GitHub foundation CI.
- Preserved the historical device-registry schema, `RelayRevokeOutbox`, runtime-scoped browser E2EE and device-key access, native PTYs, local emulator and original-folder-first workspaces. **No** persisted device, user repository, provider auth, profile or other application's data was changed or migrated.
- Recorded twelve excluded paths with the original exact pinned Orca source hashes. Source provenance is independent of the test branch's Git history; the pinned MIT notice is retained.

## Observed verification

- Focused source absence, sidebar, historical device cleanup and local pairing tests: **14/14 PASS across 4 suites**.
- Expanded local browser, device-key and WebSocket security, mobile caller refusal, PTY streaming, terminal fit/overlay, agent launch/replay, sidebar reads, runtime pairing, historical credential revocation, headless Orcad and renderer/preload exclusion tests: **233/233 PASS across 29 suites**.
- Full TypeScript project check, Oxfmt and native/type-aware Oxlint with `--deny-warnings`: **PASS**, zero lint warnings/errors.
- Pinned Orca provenance: **PASS**, 33,506 source records; 351 current Ash modifications; 8,342 documented removals; unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.
- Guarded Electron production source build: **PASS**, plain-Node daemon entry and sandbox preload guard. Renderer boot graph: 255 chunks, 7,836.4 KB minified. Inherited ineffective dynamic-import warnings remain.
- Real Wayland Electron desktop startup using isolated profile `/tmp/ash-m8-orphan-relay-wayland-YA6wIY`: **PASS**. Renderer `Ash IDE` DOM complete, preload available, `pty.spawn`, `nativeChat` and `settings` exposed; `mobile`, `automations` and `speech` preload keys absent. HOME/XDG/Git/Codex/Claude/GH settings redirected to a disposable profile. Test Electron and profile-matched helpers stopped.
- Hosted feature-tip GitHub CI and independent post-integration `main` CI are **separate required acceptance gates**. Record their exact SHA and conclusion only after observing them.

## Remaining M8 work and safety boundaries

- `src/main/ipc/runtime-environments/runtime-environment-mobile-relay-hosts.ts`, the paired-server sidebar producer and associated remote environment/WSL host types still exist; their callers must be assessed before vertical deletion. Old mobile-cloud relay implementation modules, vendor push code, mobile web aliases, and untranslated/unused phone strings in locale JSON files also remain.
- A source build and real source-app GUI startup are **not** packaged AppImage verification; separate packaged daemon/listener/socket tracing, X11 and macOS/Windows, real provider authentication and full M8 acceptance are open.
- Reused the clean `/home/suraj/projects/Ash-IDE-worktrees/m8-local-ws-no-mobile-forward` implementation checkout on a new feature branch. No new worktree, destructive cleanup, other-branch changes or force push. Canonical `main` stays at the previous accepted tip until feature CI succeeds.
