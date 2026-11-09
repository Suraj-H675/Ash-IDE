# SEC-04 — account-bound Claude overlay receipt foundation

- **Date:** 2026-11-09 (Asia/Kolkata)
- **Branch/base:** `feat/sec04-claude-account-receipt` / `c4d03335022e7aafa69d28e2ec375b046d5b161a`
- **Result:** an Ash-private, version-2 receipt can bind an existing UUIDv4 session overlay to a verified local managed Claude profile and recover that binding after restart.
- **Production hook-write gate:** remains disabled. No production process-spawn caller, RPC, preload, or renderer integration was added.

## Boundary and stored identity

The existing version-1 receipt remains readable through `recoverAshClaudeSessionSettings`. It is still unbound and cannot be promoted by `recoverAshClaudeSessionSettingsForManagedAccount`. Passing a managed profile to `createAshClaudeSessionSettings` writes a version-2 receipt instead. It uses the existing exclusive, fsynced, no-overwrite publication for both the overlay and receipt; a duplicate session ID or incomplete pair is not repaired or adopted.

The version-2 receipt stores the existing session UUID and overlay digest plus the managed account ID and profile home, local-host platform, canonical config-home path, physical directory device and inode captured with BigIntStats, and SHA-256 of the exact version-1 `profile.json` ownership marker. Before recovery, Ash rechecks that the supplied descriptor is the expected account namespace beneath Ash userData, the path is physical and has no symlink component, the profile and marker are private and owned by the current user, and the marker exactly identifies that account. The checks run again after publication and on every account-bound recovery. System/default, WSL, remote, unknown, retargeted, marker-tampered, cross-session, and differently selected managed profiles fail closed.

The binding stays in the Ash-private receipt and main-process types. A physical home-directory replacement at the exact same path (with the original sibling marker preserved) is now refused because its device/inode identity differs. Legacy argv issuance is guarded by a module-private WeakSet of frozen, verified v1 record objects, rather than by a mutable presence/absence field; a shallow copy stripping a v2 field fails closed. `SleepingAgentSessionRecord` and renderer state were not extended, and the version-2 result is rejected by the legacy argv helper. A caller must use the explicit managed-account recovery helper, which verifies the profile before returning argv. No provider settings file or credential is opened or written; tests use disposable synthetic profiles and compare the separate foreign settings file byte-for-byte.

## Saved-session account lookup

`recoverOriginalManagedClaudeAccountForSavedSession` is a separate, explicit main-process API. It accepts a saved Claude record only as a candidate UUID, reads the matching Ash-private receipt with the existing bounded no-follow private-file reader, requires a strict version-2 receipt, derives the host profile with `describeClaudeProfile(ashUserData, accountId, { runtime: 'host', executionHostId: 'local' })`, and delegates marker, physical-directory, and overlay verification to `recoverAshClaudeSessionSettingsForManagedAccount`. It returns only the original profile and readonly managed identity tagged `consistency-only`. It **does not return settings argv or any launch command**: a saved hook/renderer UUID does not authorize process creation.

The saved record's provider UUID comes from hook/renderer state and is **not** authenticated acquisition evidence. The API rejects non-Claude, non-UUIDv4, remote, explicit WSL, fork, anonymous, provider-key mismatch, and cross-session inputs, but those checks do not establish who created the provider session. The current account selection is not consulted. This helper has no production caller and does not authorize spawn, RPC, renderer, status-hook, PTY-reattach, or global-hook behavior.

## Verification

Focused Vitest coverage exercises version-1 compatibility and non-adoption, version-2 publication and simulated restart recovery, account-switch refusal, cross-session receipt refusal, marker tampering, symlink retargeting, a new physical directory replacing the original under the same pathname, copied records with stripped managed identity, remote/WSL/default-path refusal, duplicate no-overwrite behavior, content verification, and unchanged foreign settings. Saved-record recovery adds synthetic cases for account A after the disposable Ash-managed host selection pointer changes to B, mismatched UUIDs, v1/unbound and malformed receipts, foreign hardlink/symlink/public/oversized receipt refusal, marker and physical-directory identity failure, and inconsistent remote/WSL/fork/anonymous/provider metadata. The positive saved-record fixture passes Ash's actual persistence schema and supplies a complete launchConfig; and negative cases assert the particular refusal reason so unrelated ID mismatches cannot mask a missing guard. These tests use disposable profiles and do not read provider credentials. The recovery tests are included with the existing overlay receipt and dormant launch adapter foundation suites.

The focused invocation with saved-session recovery passed **68/68 tests**:

```sh
CI=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run \
  --config config/vitest.config.ts --pool=threads --maxWorkers=1 \
  --no-file-parallelism \
  src/main/agent-hooks/session/ash-claude-session-settings.test.ts \
  src/main/runtime/terminal/launch/ash-claude-session-overlay-recovery.test.ts \
  src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.test.ts
```

The full Node TypeScript project check passed with the repository runner and native compiler:

```sh
node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs \
  --project=config/tsconfig.node.json --compiler=native --checkers=1
```

Changed TypeScript files passed native Oxlint and Oxfmt. The shared `ash-claude-session-settings-core.ts` was extracted from the lifecycle module to respect the repository maximum-file-length rule (193 and 275 lines, respectively). `node config/scripts/provenance/verify-source-ledger.mjs` verified 33,506 upstream records, 210 Ash edits, and 8,260 documented removals.

Post-review verification independently executed on this worktree:

- **81/81** passing across 12 explicit suites: both overlay receipt and host adapter tests, account preservation, global-hook gates, degraded launches, daemon live-pane adoption, and **six native Claude Code 2.1.286 synthetic loopback E2E cases**. The native fixture used a fake API key and isolated Ash/provider homes, with a Linux managed-policy guard—no authenticated provider account.
- All Node/renderer TypeScript project checks passed using `node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs`.
- `node_modules/.bin/oxlint` and `node_modules/.bin/oxfmt --check` passed on all four changed TypeScript files, including the new core and managed-profile verifier.
- `ORCA_CLI_BUILD_COMPILER=tsrs node config/scripts/cli-build/build-cli.mjs` passed.
- `node config/scripts/desktop-build/execution/run-electron-vite-build.mjs` passed, with existing chunk-size/ineffective-dynamic-import and CSS optimizer warnings.
- `node config/scripts/workspace-package-build/build-workspace-packages.mjs` was **not verified locally**: its read-only pnpm task-state safety check rejected this worktree's temporary `node_modules` symlink (`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`). The policy was not bypassed; the normal independent GitHub CI checkout must verify the package build.

The actual combined regression command was:

```sh
ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/home/suraj/.local/bin/claude CI=1 \
node config/scripts/test-runtime/execution-policy/run-vitest.mjs run \
  --config config/vitest.config.ts --pool=threads --maxWorkers=1 \
  --no-file-parallelism \
  src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.test.ts \
  src/main/agent-hooks/session/ash-claude-session-settings.test.ts \
  src/main/agent-hooks/session/ash-claude-native-stop-resume.e2e.test.ts \
  src/main/agent-hooks/session/ash-claude-native-overlay.e2e.test.ts \
  src/main/runtime/terminal/launch/ash-claude-degraded-status-launch.test.ts \
  src/main/runtime/terminal/launch/ash-claude-live-pane-adoption.test.ts \
  src/main/runtime/terminal/launch/ash-agent-account-env-snapshot.test.ts \
  src/main/runtime/terminal/launch/orca-runtime-terminal-create-replay-after-close.test.ts \
  src/main/agent-hooks/ash-provider-hook-callsite-gates.test.ts \
  src/main/agent-hooks/ash-shared-hook-disable.test.ts \
  src/main/orcad/ash-managed-provider-hook-startup.test.ts \
  src/main/providers/accounts/agent-auth-restart-preservation.test.ts
```

## Follow-on original-account lookup: independent verification

The new main-only `recoverOriginalManagedClaudeAccountForSavedSession` API is intentionally **consistency-only** and returns **no** `--settings` arguments, launch command, or production launch authorization. It reads an existing Ash-private version-2 receipt, reconstructs the original managed account independently of the mutable selected-host pointer, and verifies the original profile marker, directory device/inode, and settings digest. A valid `SleepingAgentSessionRecord` schema fixture with `state: waiting` exercises this without creating or modifying a real provider account. Original session UUIDs supplied by hook/renderer state remain untrusted until correlated with a main-issued PTY launch, launch token, and first accepted Claude SessionStart.

The independent GPT-6 Luna/xhigh read-only reviewer confirmed that the no-argv return type, schema-valid fixture, actual disposable selected-host pointer change, specific negative refusal reasons, and foundation CI test registration address all findings. The reviewer ran no tests; the integrator independently reproduced the following on the feature worktree:

- **68/68** tests across the three targeted receipt, saved-session recovery, and host-only launch-adapter suites.
- **99/99** tests across 13 suites, including six native synthetic Claude Code loopback cases, degraded status, live pane reattachment, provider-account preservation, and provider-global-hook gates.
- Full Node/renderer TypeScript checks, type-aware and native Oxlint on the new files, Oxfmt verification, and source-provenance validation passed.
- Retained workspace-package build, Ash CLI (`ORCA_CLI_BUILD_COMPILER=tsrs`) build, and Electron desktop bundle all passed on the feature worktree. The desktop bundle emitted existing chunk-size and ineffective-dynamic-import warnings, not failures.
- The `foundation.yml` test manifest includes `ash-claude-session-overlay-recovery.test.ts` and the helper has no production caller.

The 13-suite invocation was:

```sh
ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/home/suraj/.local/bin/claude CI=1 \
node config/scripts/test-runtime/execution-policy/run-vitest.mjs run \
  --config config/vitest.config.ts --pool=threads --maxWorkers=1 \
  --no-file-parallelism \
  src/main/runtime/terminal/launch/ash-claude-session-overlay-recovery.test.ts \
  src/main/runtime/terminal/launch/ash-claude-session-overlay-launch.test.ts \
  src/main/agent-hooks/session/ash-claude-session-settings.test.ts \
  src/main/agent-hooks/session/ash-claude-native-stop-resume.e2e.test.ts \
  src/main/agent-hooks/session/ash-claude-native-overlay.e2e.test.ts \
  src/main/runtime/terminal/launch/ash-claude-degraded-status-launch.test.ts \
  src/main/runtime/terminal/launch/ash-claude-live-pane-adoption.test.ts \
  src/main/runtime/terminal/launch/ash-agent-account-env-snapshot.test.ts \
  src/main/runtime/terminal/launch/orca-runtime-terminal-create-replay-after-close.test.ts \
  src/main/agent-hooks/ash-provider-hook-callsite-gates.test.ts \
  src/main/agent-hooks/ash-shared-hook-disable.test.ts \
  src/main/orcad/ash-managed-provider-hook-startup.test.ts \
  src/main/providers/accounts/agent-auth-restart-preservation.test.ts
```

This is **not** acceptance of authenticated provider identity, a trusted hook-to-launch correlation, or physical GUI integration. Automatic production hook attachment remains off; global provider hook writes remain forbidden.

## Independent review and corrective evidence

An independent GPT-6 Luna/xhigh read-only review found two pre-acceptance issues in the first draft. **Both were reproduced as failing regressions before repair**:

1. **P2:** a new physical `home` at the same pathname passed because the receipt recorded the canonical name but not the directory identity. The receipt now includes stringified BigInt device/inode values, the verifier checks they remain stable during verification, and recovery compares them with the durable receipt. The original test used a rename to retain the old inode while creating a different private directory at exactly the same path and preserving the sibling `profile.json`; the test now passes only because recovery rejects the replacement.
2. **P3:** the legacy pure argv helper trusted a mutable optional `managedAccountIdentity` field, so shallow-copying a v2 record without that field bypassed the guard. It now only accepts frozen records issued into a module-private v1 record set by verified v1 creation/recovery. A copy stripping the field, or a copy of a valid unbound record, is rejected. The v2 caller must take the explicit verified managed-account recovery path. The issuer and WeakSet now live privately in the verified lifecycle module, not as an exported core-module function. The shared core module holds only receipt schemas, types, safe payload construction and filesystem validation; both modules respect the repository file-length lint limit.

These protections bind an Ash-managed **filesystem directory**, not the authenticated Claude provider login. An authenticated identity or credential refresh can change without changing the marker; no provider credentials were read. Static path verification also cannot prevent another same-OS-user process from replacing the directory between verification and a future spawn. Production activation remains blocked.

## Remaining blockers and limits

- `SleepingAgentSessionRecord` still has no durable managed account ID or trusted acquisition proof. The consistency API maps its unverified hook/renderer UUID to a v2 receipt, but there is no durable correlation between provider session creation, the original account, and the PTY spawn. A trusted main-process binding is still required before any process-spawn integration.
- The new recovery helper is not called by the dormant launch adapter or by production PTY spawn. Existing ordinary launch behavior and provider-hook writes remain unchanged.
- The receipt identifies a managed filesystem profile, not the authenticated provider login. Credentials and provider authentication state remain unread.
- Device/inode is **best-effort physical identity**, not a permanent directory generation. A filesystem may eventually **reuse an inode after the original directory is deleted**; the reproduced test holds the original inode allocated by moving the directory aside. Production continuity needs a durable per-home generation token or explicit invalidation of old bindings on account reprovisioning, without silently changing existing provider profiles.
- `lstat`, `open(O_NOFOLLOW)`, BigInt device/inode comparison, and `realpath` detect static symlinks and path or ordinary directory replacements, but the checks do not pin a directory handle through a later spawn. A future caller must reverify at its sensitive boundary; stronger race resistance needs handle-relative filesystem operations.
- The receipt protects against accidental replacement and unrelated writers. Another process running as the same OS user can edit both Ash-private files and is outside this integrity boundary.
- The version-1 two-file publication crash gap remains fail-closed and is reused for version 2. No automatic cleanup was added.
