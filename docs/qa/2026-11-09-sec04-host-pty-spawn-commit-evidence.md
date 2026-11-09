# SEC-04 — host PTY spawn commit evidence

This milestone adds a main-process-only, in-memory receipt for a fresh local PTY after the shared spawn commit succeeds and the host pane binding is persisted. The receipt binds the provider-returned PTY ID and incarnation to the persisted worktree/tab/leaf pane, and stores only a SHA-256 hash of the effective launch token. It is bounded to 256 receipts per runtime, rejects duplicate PTY/incarnation keys, survives GUI surface closure, and retires on PTY exit or bounded eviction.

Other agents and ordinary shells, adopted panes, provider reattachments, remote/daemon/WSL routes, refused or synthetic exits, mismatched provider results, missing token/incarnation, and stale or absent persisted pane bindings do not produce receipts. No renderer, RPC, preload, CLI startup, account-router, provider-hook, or daemon behavior changed. `canAshWriteProviderGlobalHooks()` remains `false`.

Account attribution is deliberately unresolved: `accountEvidence` is `missing` because host-verified authenticated Claude account identity is not frozen alongside the effective process environment. The receipt is not connected to the dormant Claude correlation state machine. SEC-04 account-to-PTY correlation and AG-05/AG-07 acceptance remain open.

A `claude` command recognition is a non-authoritative classification hint, not proof that the provider process ever reached an authenticated Claude login. The recorder additionally refuses a PTY that synchronously reports exit while the runtime exit listener is being registered.

The existing terminal launch result path still carries its pre-existing raw `launchToken` field for current launch handling; this receipt adds no token field to that response, logging, renderer events, or snapshots. Removing that existing field would require a separate compatibility change to the launch-result contract.

## Independent acceptance verification (feature worktree)

The implementation Codex agent completed its work without committing or pushing. The integrator independently corrected three TypeScript fixture errors (optional `spawnFresh`, mock runtime type, negative-case typing), supplied the full required adopted-owner fixture, restricted receipts to recognized Claude launch candidates, and added refusal cases for ordinary/non-Claude terminals and synchronous PTY exit during subscription. The positive integration fixture calls the actual runtime `spawnPtyFromRuntimeController` and observes the provider-returned PTY/incarnation only **after** binding persistence; the provider itself is a fake local PTY, not an authenticated Claude process.

- **32/32 tests passed, seven suites**: newly added commit evidence (20), real runtime `spawn` admission and commit paths, live Claude pane adoption, daemon parity, and replay-after-close.
- **169/169 tests passed, 15 suites**: previous SEC-04 managed-account/correlation, provider safety and hook-disable, PTY adoption, and six synthetic native Claude launch/resume cases. Native cases use disposable homes with a loopback fake provider. No real Claude account or provider-global setting was accessed.
- Full Node/renderer TypeScript projects: PASS. Changed-file native and type-aware Oxlint (`--deny-warnings`), Oxfmt, `git diff --check`: PASS.
- Source provenance: PASS, 33,506 pinned upstream records, 212 modified upstream files, 8,260 documented removals, licensing unchanged.
- Ash CLI build (`ORCA_CLI_BUILD_COMPILER=tsrs`) and Electron desktop bundle: PASS. The latter retains existing chunk-size and ineffective-dynamic-import warnings; a successful bundle is not evidence of physical Wayland/X11 or packaged AppImage function.
- The read-only security review and GitHub foundation CI on the exact feature/main commit must be separately observed before final integration.

**Trust boundary:** `isClaudeLaunch` is only lexical command recognition. The existing configured `launchToken` can be supplied externally and appears in pre-existing terminal public facts; its hash here is a consistency marker, **not a private host-issued authentication token**. The effective child environment and authenticated provider account are unproven, so `accountEvidence.status` remains `missing`. This feature must not be used by the dormant root-`SessionStart` correlation API to authorize hooks, account selection, PTY recovery, resume or session promotion. Runtime closure/daemon crash recovery is unproven; physical desktop and packaged AppImage acceptance remain open.
