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

## Open acceptance gates

The CLI `--version` smoke proves argument acceptance, **not** live hook execution, whether the command-line hook event arrays merge with or override foreign/user hooks, or whether an overlay remains active on session resume. Before enabling this on real sessions, verify actual Claude hook event delivery, precise status, preservation of effective third-party hook behavior, account binding, live daemon/window recovery, overlay lifetime and cleanup after terminal exit, and compatible Windows handling. The prototype currently targets POSIX shell command formatting only. No global-provider writes or native authenticated turns were performed.

**Result:** an isolated session-scoped settings transport has been implemented and fixture/native-CLI smoke verified; SEC-04 and AG-07 full acceptance remain **open**.
