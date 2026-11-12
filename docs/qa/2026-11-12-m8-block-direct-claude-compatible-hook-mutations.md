# M8 — Close direct Claude-compatible global-hook mutation bypasses

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** canonical `main` `f6d9cc42f114f176b8897267b6f95a1b3eb73ca0` clean and synchronized with `origin/main`; [GitHub Actions run 43270573460](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43270573460) concluded **success**. Independent feature branch `fix/m8-guard-direct-claude-openclaude-hooks`, worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-guard-direct-claude-openclaude-hooks`.

## Risk and implemented boundary

Although `managed-agent-hook-controls.ts` already blocks provider-global installs/removals without verified Ash ownership, callers can instantiate or import `ClaudeHookService` and invoke its methods directly. This shared service implements **Claude, OpenClaude, Qoder, Qoder-CN, Qwen Code and CodeBuddy**. Its old `install()`, `remove()`, `installRemote()` and `refreshManagedScripts()` paths could mutate shared provider settings, overwrite managed scripts, refresh Claude agent-view bindings or reach remote SFTP routines without the central ownership check. Claude account profile setup also creates a separate service instance in a worker.

All four direct mutation entrypoints now enforce the **same existing fail-closed** `canAshWriteProviderGlobalHooks()` policy before any provider-home path calculation, credential/account lookup, file read/write or SFTP access. A blocked synchronous or remote operation reports `state: skipped`, `skipReason: ash_ownership_unavailable`, without falsely claiming installation or removal; a blocked refresh is a no-op. This is an internal safety backstop, **not** an opt-in switch or a production write authorization. A separate `readClaudeCompatibleHookStatus` module preserves the existing **read-only** status classification, Windows exec-form compatibility, and profile-default-home alias refusal without exceeding code-size limits.

The Claude account profile worker still receives the skipped status through its existing report/warning mechanism; this change does not silently install hooks during account setup. No real provider configuration, Orca profile, credentials, script or remote host was touched. Terminal-first agents and existing native/structured chat paths remain independent of global hook installation.

## Feature-worktree evidence

- **Red-first:** after accounting for `/tmp` temporary-file quota, the new direct-service negative tests reproduced old bypasses for direct install/remove/refresh/remote hooks, while read-only status inspection passed. **7/7 focused tests passed** after the fix, covering all six Claude-compatible agents, isolated account-worker service instances, non-mutating status, and unavailable remote SFTP behavior.
- Full workspace TypeScript check: **PASS**; lint/formatting on all changed source/tests **PASS**.
- Selected Ash security, provider-ownership, crash-recovery, credential, desktop/server packaging tests: **177/177 across 23 suites PASS**, including the final profile-worker test.
- Separately executed `src/cli/runtime/offline-admission-commands.test.ts` had **10/10 failures** with `TMPDIR=/var/tmp`; the same ten failures were reproduced **unchanged on canonical base `main`**, so they are inherited baseline issues, not accepted as green or repaired by this security milestone.
- Linux `/tmp` tmpfs exposes a separate user write quota (`EDQUOT`) despite reported free capacity; tests are run with `TMPDIR=/var/tmp` and the real runtime smoke now gives child processes private `TMPDIR`, `TMP` and `TEMP` inside its disposable fixture. This avoids SQLite temporary-file failures without bypassing runtime assertions or deleting unrelated data.
- Desktop asset build: **PASS**, sandbox preload verified and CLI closure checked (1,224 files / three commands).
- Standalone Node build: **PASS**, Node 24.22.1, **12.78 MB / 8,145 modules**, zero forbidden Electron or `node:sqlite` imports, native PTY/glibc compatibility verified. The cache archive was independently verified against the lockfile SHA-512 before the unchanged build.
- Four-host plain-Node runtime/PTY: **PASS**, original-folder live terminal survived runtime stop/restart, with test-owned Orca credential, policy and Grok owner/hook sentinels preserved.
- Native **Linux Wayland source Electron**: **PASS** with disposable HOME/XDG, private compositor/DBus and provider profiles, GUI DOM ready, retained GitHub/GitLab/browser/PTY/runtime/native chat surfaces, authenticated CLI terminal, Ash-owned shortcut IPC, explicit daemon/runtime shutdown and **zero** test-owned processes. Synthetic foreign Orca hook script remained unchanged.
- Pinned source hash/provenance: **PASS**, 33,506 pinned upstream file records, 460 Ash-adapted sources, 8,508 documented exclusions and unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Open boundaries

Other provider-specific direct hook writers/removers—notably Codex with its launch-home/WSL trust preparation—still need dependency-grounded review and provider-specific negative testing before any broader policy changes. The uncooperative external-provider writer race also prevents enabling global hook changes. This milestone is not user-approved real-provider hook installation, packaged AppImage verification, native Windows/macOS acceptance, or full M8 release acceptance. The baseline offline CLI failures are tracked as separate required fixes; new GitHub CI status must be reported after push, not inferred from local tests.
