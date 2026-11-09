# SEC-04 M2 — host Claude launch correlation consistency contract

- **Date:** 2026-11-09 (Asia/Kolkata)
- **Result:** dormant, in-memory consistency contract; no production launch or hook caller.
- **Acceptance:** AG-05, AG-07, and SEC-04 remain **open**.
- **Provider-global hook-write gate:** `canAshWriteProviderGlobalHooks()` remains `false`.

## What this milestone implements

`ClaudeHostLaunchCorrelationConsistency` is a main-process-only state machine for synthetic or future host snapshots. It checks a local Linux/macOS managed-account selection, freezes the selected account identity and verified ownership-marker device/inode, checks supplied PTY/instance identifiers are distinct from the tab ID, and issues a fresh random launch token while retaining only its SHA-256 hash. It accepts at most one UUIDv4 root `SessionStart` per binding; resume candidates require the exact expected provider UUID. It rejects conflicting active pane bindings, child/fork/remote/WSL observations, token mismatch, changed PTY incarnation, replays, and events after close or retirement. It uses CSPRNG-issued UUIDv4 tokens, caps active state at 512 pane bindings, reaps closed/retired tombstones when needed, and never accepts an old token for a replacement pane. Its first `SessionStart` source must be exactly `startup` for fresh launches or `resume` for explicit resume, not `clear`, `compact`, or unknown. Unknown replay, fork, remote, and WSL verdicts fail closed.

The result is always tagged `consistency-only`. The candidate's claimed PTY and launch facts are not evidence that the command actually spawned in that PTY. The module has no production caller, and it returns no spawn authorization, settings argv, hook-installation permission, RPC payload, or renderer state. No state is persisted. The ownership-marker device/inode is captured by `verifyClaudeManagedAccountProfileWithMarkerIdentity` for this in-memory contract. The verifier also registers its immutable verification result in a private `WeakSet`, so copying a symbol-branded record does not create a verified account. Existing provider-session receipt formats and their original verifier API remain unchanged.

## Source-derived trust limits

- `ClaudeProfileRouter` derives the selected account from mutable settings and maintains a mutable selected-profile pointer. The existing profile verifier can independently validate an Ash-managed profile identity, but that does not authenticate which Claude login a running process used. The private marker + directory inode are best-effort identity: inode reuse and same-user compromise cannot be excluded.
- `spawn-preflight.ts` prepares host environment and account routing before provider spawn. Actual PTY ID and incarnation arrive through later spawn results; no caller currently passes those facts together with the verified account snapshot into this contract.
- Configured launches mint an `ORCA_AGENT_LAUNCH_TOKEN`, while `server-lifecycle.ts` separately checks the HTTP hook bearer token. `server-authority-evidence.ts` stores launch-token hash, pane, and connection evidence, but that record has no account identity or PTY incarnation.
- The Claude hook parser can extract provider session metadata. The current hook path does not supply this contract with an independently verified root-versus-child admission joined to the same running PTY incarnation.
- `worktree-sleep-resume-recording.ts` saves resume identity from accepted hook/status rows. That row is not a host-issued spawn binding. Overlay recovery likewise returns consistency-only output and cannot authorize spawn or reattachment.

These facts mean the test fixture's host snapshots are synthetic assumptions. The correlation method still consumes caller-supplied `pty.running`, pane, worktree, root-admission, and event metadata; it neither consults the authoritative runtime registry nor joins the actual spawned command with the effective account environment. The returned `launchToken` and account snapshot are host-internal only and must not be exposed via renderer, RPC, preload or persistence. Passing the consistency checks does not establish real Claude account ownership, authenticated provider identity, trusted normalized hook-event provenance, or durable crash recovery.

## Next integration requirements

Before any production consumer treats this as authority, the main process must join a frozen launch-time account selection and verified managed-profile marker identity to the actual newly spawned local PTY ID and incarnation. It must prove the same incarnation is still running and owns the same stable pane/worktree when the root `SessionStart` arrives, reject live-pane adoption and non-local runtimes, and derive root admission from provider evidence that distinguishes child/fork events. Resume must compare the exact pre-existing Claude UUID. The launch token must be fresh for that spawn and delivered only through the host-controlled Claude launch path. Exact close/retirement must fence late events. Only after that path is hardened should a separate milestone design durable recovery; this in-memory state makes no crash-recovery claim.

Keep ordinary Claude launch, fallback, and daemon live-pane adoption unchanged. Do not attach hooks in production or change global provider settings until the ownership, reversible-uninstall, fallback, and real-provider acceptance gates are complete.

## Verification

The focused suite uses two disposable Ash-managed profile fixtures under the operating-system temporary directory. It does not access real account files, provider settings, credentials, Orca data, or external repositories. It covers fresh first-wins, exact resume UUID, account snapshot immutability, marker device/inode capture, rejection of cloned symbol-branded account evidence, managed-account and local-runtime requirements, cross-pane token mismatch, pane/worktree and PTY-incarnation mismatch (including oversized incarnation IDs), child/fork/replay rejection, missing provenance verdicts, `clear`/`compact`/`fork` SessionStart rejection, bounded live bindings with retired-state reclamation, and closed/retired fencing. The suite also asserts the production hook-write gate remains disabled.

## Validation record

The integrator independently executed the following checks on the isolated feature worktree after the implementation agent's handoff:

- **91/91** focused tests across the correlation contract (50), private Claude overlay receipt (23), and original managed-account saved-session recovery (18).
- **149/149** broader tests across 14 security/runtime/provider suites, including six native Claude Code synthetic loopback `SessionStart`/`Stop` and resume cases, durable receipt recovery, live PTY adoption, account-env snapshot, degraded fallback, and global-hook isolation. The native fixture used isolated disposable homes and a fake loopback-only provider, not credentials from an authenticated account.
- Full Node/renderer TypeScript projects: **PASS** (`node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs`).
- Native and type-aware Oxlint (`--deny-warnings`) and Oxfmt `--check` on all three changed TypeScript files: **PASS**, zero warnings/errors.
- `node config/scripts/provenance/verify-source-ledger.mjs`: **PASS**, 33,506 upstream records, 210 Ash edits, and 8,260 documented removals.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs`: **PASS**.
- `node config/scripts/desktop-build/execution/run-electron-vite-build.mjs`: **PASS**, with existing chunk-size and ineffective-dynamic-import warnings.
- `git diff --check`: **PASS**. The source/test/build checks used a temporary link to the canonical already-installed `node_modules`, removed on each command exit. No package-manager safety policy was bypassed. The retained workspace-package build remains **unverified locally on this symlinked worktree** and must pass in the normal independent GitHub CI checkout before integration.

An independent GPT-6 Luna/xhigh read-only reviewer found **no live production exposure**, but identified four important future **P2 authorization blockers**: caller-supplied PTY/spawn facts, caller-supplied root event provenance, account evidence before spawn integration, and token/binding lifecycle. The dormant implementation now uses a module-issued profile verification result, explicit source/verdict rejection, CSPRNG-only token creation and bounded binding maps; an independent GPT-6 Luna/xhigh follow-up reviewer examined these fixes and found no P1/P2 blocker for **dormant** integration. Its P2 production-authorization findings remain open. Crucially, these mitigations **do not** establish authority until main-process spawn commit and normalized hook ingestion supply the facts.

No test result implies provider login authentication, real spawn-to-hook correlation, real graphical acceptance, or AG-05/AG-07/SEC-04 acceptance.
