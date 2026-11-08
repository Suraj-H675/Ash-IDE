# SEC-04 — nonmutating Claude session settings transport foundation

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Purpose:** avoid the non-atomic check-and-unlink race inherent in rewriting a provider-global `settings.json` that other applications may concurrently edit.
- **Implementation:** `src/main/agent-hooks/session/ash-claude-session-settings.ts` and the companion disposable-fixture tests.
- **Production hook-write gate:** `canAshWriteProviderGlobalHooks()` remains **false**; this module has **no live launch/settings/account callsite**.

## Interface and isolation

Claude Code documents `--settings <file-or-json>` for one session, with command-line settings taking precedence over user/project/local settings but below managed settings. Ash can prepare only its own private JSON file under `ashUserData/provider-session-settings/claude-<session-uuid>.json` and provide a separate `['--settings', path]` argv pair. The prototype accepts only known `SessionStart` and `Stop` command hooks, requires absolute POSIX script paths and explicit bounded timeout **seconds**, quotes executable filenames, rejects caller-supplied conflicting settings flags, and never reads or writes a provider account's `settings.json`, user trust state, Orca configuration, or another repository.

The Ash profile and overlay directory require private ownership and directory permissions on POSIX; files are created mode `0600`, staged and published via a no-overwrite hard link, and fsynced. Duplicate session IDs, unsafe paths/symlinks, malformed hook events, changed overlay file content, and cross-profile verification fail closed. A failed duplicate-session publication removes only its own temporary file after confirming the inode identity.

## Real evidence

- Disposable unit tests verify overlay creation and permissions, exact JSON hook command form, independent sessions, duplicate creation and temporary-stage cleanup, source/config isolation, unsafe input refusal, symlink and permissions checks, tamper detection, and argv conflicts.
- With fresh disposable `HOME`, `CLAUDE_CONFIG_DIR`, XDG configuration/cache directories, and Ash userData, an actual locally installed **Claude Code 2.1.286** process successfully ran `claude --settings <ash-overlay-path> --version`, exited zero, and did not change a separate disposable foreign `settings.json`. No provider login, API turn, or user account was involved.
- The earlier guard tests prove that the native shared-file writer still has an unsolved check-and-unlink race; keeping it disconnected is intentional rather than silently weakening SEC-04 requirements.

## Native Claude hook-coexistence execution (separate opt-in E2E)

On **Linux 7.2.11-arch1-1 x86_64**, with **Node 24.22.1** and the existing local **Claude Code 2.1.286**, the real native CLI executed a `SessionStart` command hook from an isolated `CLAUDE_CONFIG_DIR/settings.json` and a separate `SessionStart` command hook from Ash's private `--settings` overlay in the *same process*. Two independent commands appended `FOREIGN_SESSION_START` and `ASH_SESSION_START` to a disposable hook-event log. The on-disk foreign settings bytes were unchanged before and after the test, and Ash's overlay SHA-256 verification remained valid. A no-overlay control executed `FOREIGN_SESSION_START` alone.

Both native suites now require Linux with no system-managed Claude settings root (`/etc/claude-code`), and fail closed when that root exists or cannot be inspected. Managed policy can override test-supplied provider routing; this restriction avoids using the isolated test on an unsuitable host. See `docs/qa/2026-11-08-sec04-claude-native-stop-resume.md` for the separate completed-turn and explicit-resume tests.

This is covered by `src/main/agent-hooks/session/ash-claude-native-overlay.e2e.test.ts`. It is explicitly **opt-in** because ordinary GitHub Actions runners do not have the real Claude CLI. Run against an already installed Claude executable; **do not install, upgrade or use a real account just for the test**:

```bash
ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/absolute/path/to/claude \
  CI=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run \
  --config config/vitest.config.ts --pool=threads --maxWorkers=1 \
  --no-file-parallelism \
  src/main/agent-hooks/session/ash-claude-native-overlay.e2e.test.ts
```

The test constructs fresh mode-`0700` temporary HOME, XDG, Claude profile, Ash data and workspace directories. The only authentication value is a synthetic fixture key, and `ANTHROPIC_BASE_URL` is set to a loopback HTTP server which **never returns a model response**. Nonessential Claude traffic and updates are disabled. The test observes hook-log changes via a filesystem watcher, stops only its own spawned Claude child after observing the expected events, and has bounded startup and shutdown deadlines. No real model request is completed, and it does not open or edit `~/.claude`, provider credentials, existing Orca data, or a real repository.

**Observed result:** two native E2E cases PASS. Initial interactive startup with no synthetic key stopped before hook dispatch; an initial fast-503 loopback harness also failed to observe both hooks and was corrected to hold the local request open for bounded observation. The corrected cases re-verify the executable's `--version` output before launch. During post-integration checks, both markers appeared on disk but a single `fs.watch` callback was missed by the Bun Vitest worker. The observer now uses a bounded `fs.watchFile` fallback plus a final exact-marker check at its deadline; **three consecutive 2/2 native runs passed after this correction**. The native CLI and both hook scripts are unchanged by this test-only observer repair.

## Durable recovery addendum

Ash now keeps a private, versioned SHA-256 receipt beside each new session overlay and can reconstruct a verified `--settings` argv pair from an Ash session UUID after a host restart. This deliberately does **not** attach hooks to production Claude launches or clean up persisted overlays automatically. See `docs/qa/2026-11-08-sec04-claude-overlay-durable-recovery.md` and its regression tests for the ownership and interrupted-publication boundaries.

## Open acceptance gates

The native E2Es verify **`SessionStart` and `Stop` coexistence in synthetic completed turns**, explicit `--settings` reattachment on native `--resume`, and retention of an unchanged Ash-private overlay for a new process. They do **not** establish complete schema merge semantics, enterprise-managed policy precedence, authenticated status accuracy, or implicit overlay persistence on resume. Before production attachment, verify other hook events where required, third-party settings behavior under managed policy, account binding, live daemon/window recovery, overlay lifetime/retirement after session-history deletion, and compatible Windows handling. The prototype currently targets POSIX shell command formatting only. No global-provider writes or native authenticated turns were performed.

**Result:** an isolated session-scoped settings transport has been implemented and fixture/native-CLI smoke verified; SEC-04 and AG-07 full acceptance remain **open**.
