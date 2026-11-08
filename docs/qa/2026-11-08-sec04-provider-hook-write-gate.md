# SEC-04 / AG-07 — provider-global hook write gate

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Scope:** Ash's headless startup, desktop/runtime hook settings, direct managed-hook installer, and Claude account-profile setup.
- **Status:** code-level and fixture testing; real provider authentication, hook ownership ledger, and live hook-backed status **remain unaccepted**.

## Reason for the gate

The inherited Orca implementation registered managed Claude/Codex hooks, refreshed OpenCode plugins, and reconciled Claude agent-view bindings during headless startup. Explicitly enabling Ash status hooks also invoked managed installers. These operations can write provider-native configuration shared with other applications. A process having the same account access does **not** establish ownership of an individual hook entry, script, or trust approval.

## Behavior while ownership is unavailable

1. `canAshWriteProviderGlobalHooks()` fails closed until an Ash-owned, per-entry provenance and reversible-uninstall ledger exists.
2. Both direct `installManagedAgentHooks()` and settings-driven `applyAgentStatusHooksEnabled()` return **skipped** results with `ash_ownership_unavailable` when enabled, or `hooks_disabled` when monitoring is off. Observed physical entries may still be reported via `managedHooksPresent`; they are never claimed as Ash-installed.
3. Headless startup does not run the inherited Codex reconciliation, generic managed-hook installer, OpenCode plugin refresh, or Claude agent-view reconciliation. Settings and account-service listeners also do not write Claude plugin bindings.
4. Claude account-profile setup passes `hooks: false` to its provider-home worker and does not append an agent-view plugin. The provider's authentication and normal terminal launch remain independent of this hook integration gate.
5. The local status receiver and terminal process/PTY evidence remain available. **Do not claim complete hook-backed agent status while this gate is active.**

## Evidence and next requirement

New dynamic tests first failed against the inherited startup and enable paths, then passed after the gate. Additional regression assertions prevent startup, settings, account and Claude profile call sites from silently reintroducing the writes. CI runs these tests alongside the existing runtime/provider suite. Tests do not touch user provider files or tokens.

The existing `src/main/providers/accounts/agent-auth-restart-preservation.test.ts` suite also passed **5/5**, confirming the related account-service refactor did not regress its fixture-level login/restart guarantees.

### Native Arch Linux / Wayland smoke (disposable profile)

- Built the source Electron and CLI bundles in the isolated feature worktree and started the native Wayland `ash-ide` window with a new mode-`0700` profile under `/tmp/ash-m2-hook-gate-smoke-20261108-*/` and a disposable non-Git workspace.
- Authenticated local `status --json` returned `runtime.state=ready` for Electron PID `2955524`. Registered only the disposable folder and created a terminal through Ash's CLI with Claude Code 2.1.286 and independent `HOME` / `CLAUDE_CONFIG_DIR` paths. The actual Claude process PID `2956668` reported the genuine **Welcome to Claude Code** first-run interface through the terminal screen reader. `/proc` confirmed the isolated provider environment.
- Monitored existing Claude, Codex, and Orca file size/mtime metadata was unchanged before/after startup and this launch. This limited metadata check is not proof that no filesystem path anywhere changed; no user account login or model turn was attempted.
- `terminal-daemon stop` previewed **one** disposable session matching the recorded shell PID `2956603`. Confirmed stop returned `status=stopped, killedCount=1, mode=graceful`; the shell and Claude processes exited. The isolated runtime stop request was accepted; a subsequent CLI status returned `not_running` and the GUI process/window exited. No unrelated daemons were intentionally stopped.

This verifies real process and PTY launch while managed hooks are gated; it does not verify provider-authenticated status, packaged distribution, or Windows co-installation.

Before enabling provider-global hook writes, implement and verify ownership evidence for every Ash-created entry; unchanged preservation of existing Orca and unknown entries; rollback on partial write or conflict; and removal of **only Ash-owned** entries. Validate with disposable provider files and a controlled real-provider turn/status recovery test. Until then SEC-04 is **partially** satisfied and AG-07 is **partially** verified.
