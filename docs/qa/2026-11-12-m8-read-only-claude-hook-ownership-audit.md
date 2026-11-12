# M8 — Read-only Ash provider-hook ownership inventory and private-ledger hardening

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean `main` at `686e1c0f9625ec7a01aec82e18754dce2ea708bd`; GitHub Actions [run 43259130098](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43259130098) **succeeded**. Feature branch `feat/m8-read-only-hook-ownership-audit`, independent worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-read-only-hook-ownership-audit`.

## Scope and security boundary

Ash already stores prepared/installed Claude hook claims and reversible provider-write receipts separately under its own private `userData`. Its provider-global hook install/remove controls correctly **refuse mutation** because an uncooperative provider process can still race its file transactions. This milestone does not loosen that gate, register a hook, change a provider setting, or infer ownership from a script name.

The previous `readAshHookOwnershipLedger()` had two problems for read-only inspection: it created the private `provider-hook-ownership` directory when absent, and it could open a multi-linked ledger file (potentially another application's record). The revised reader performs **no directory creation**, checks private Ash root and directory identity/ownership/mode, refuses foreign Orca-profile aliases and linked or swapped ledger files, reads at most **256 KiB + 1 byte**, and validates inode identity, link count, size, and nanosecond timestamps before accepting a validated ledger. Explicit `saveAshHookOwnershipLedger()` remains the only operation that initializes the ownership directory and still uses exclusive locking, a durable file replacement, and revision compare-and-swap.

An added `auditAshClaudeHookOwnership({ ashUserData, approvedConfigPath })` performs an **opt-in, non-mutating** inspection using the approved Claude settings path supplied by its caller, not arbitrary paths stored in the Ash ledger. The result describes each claim as `pending`, `published_unconfirmed`, `verified`, or `conflict`. It reuses the existing pure claim planners to require the exact UUID marker, event, complete hook-definition hash and uniqueness; unrelated provider-owned entries and settings may remain. The audit returns only the claim ID, event, classification and generic diagnostic, never provider commands or secrets. Invalid, missing, linked, symlinked, corrupt or modified provider records produce a conflict rather than automatic repair.

**Not activated:** this audit is a security/diagnostic library and is not yet exposed through a production UI/CLI or permitted to drive automatic installation/removal. No real provider homes or credentials were read or changed. No source-level hooks were deleted or migrated.

## Feature-worktree evidence

- Red-first: **two expected failures** proved the old ledger read initialized a directory and accepted a hard-linked foreign ledger. The updated ledger suite and the new audit suite passed **17/17 tests** after the fix, including read-only fresh profiles, foreign Orca-root refusal, pending/published/installed states, modified/duplicated entry conflicts, and approved-path isolation.
- Existing provider transaction and crash-recovery tests initially reported one fixture that relied on the obsolete implicit directory creation. That disposable test now explicitly creates its forged-receipt directory. The full ownership transaction, removal and real crash-recovery suite then passed **97/97 tests across 10 suites**; the final bounded-reader change also passed **47/47 targeted ownership and crash-recovery tests**.
- Full `pnpm run typecheck`: **PASS**, including workspace package builds.
- Broader security and packaging regression suite: **160/160 tests across 21 suites PASS** (prior to the final bounded-reader hardening; ownership and crash-recovery suites rerun afterward).
- `pnpm exec oxfmt` and `pnpm exec oxlint`: **PASS** on affected source/tests.
- `pnpm run build:desktop:assets`: **PASS**, sandbox preload verified and CLI closure (1,224 files / three commands).
- `pnpm run build:orcad`: **PASS**, Node 24.22.1, 12.78 MB / 8,141 modules, zero forbidden Electron or `node:sqlite` imports. The lockfile-pinned watcher archive was independently verified by SHA-512 before reuse of the canonical build cache; all normal build integrity checks remained enabled.
- Real plain-Node four-host runtime/PTY smoke: **PASS**. An original-folder live terminal retained the same process and handle across runtime stop/restart; isolated foreign Orca credential and terminal-policy sentinels remained unchanged.
- Real native **Linux Wayland source Electron**: **PASS**, private KWin/DBus and disposable HOME/XDG/provider settings. Ash window DOM complete, retained GitHub/GitLab/PTY/runtime/native chat/browser interfaces, actual renderer keybindings IPC using Ash-owned path, real authenticated CLI terminal, successful runtime/daemon stop, and zero test-owned processes remaining.
- Pinned Orca source license/provenance ledger: **PASS** after final source verification. 33,506 upstream Orca records, 456 adapted Ash source hashes, 8,508 documented exclusions; unchanged upstream MIT notice SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Remaining gates

The provider transaction writer still has a documented external-writer race. A safe provider-global installation workflow needs explicit user consent, approved account home, cross-process coordination or conservative refusal, durable crash recovery, provider-native testing, and selective Ash-only uninstall. The dormant legacy Orca hook script paths are not automatically rewritten in this milestone. Full M8 security, packaged AppImage, native Windows/macOS, and release acceptance remain unverified.
