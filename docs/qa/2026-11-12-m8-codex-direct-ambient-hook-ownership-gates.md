# M8 — Block unowned Codex ambient/global hook entrypoints

**Date:** 2026-11-12 (Asia/Kolkata)

**Base:** clean canonical `main` `7bb425dbb3b10588d4868d7ce6c66e8aa79c2cf4`; [GitHub Actions 43275995360](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43275995360) **succeeded**. Independent worktree `/home/suraj/projects/Ash-IDE-worktrees/m8-guard-direct-codex-ambient-hooks`, branch `fix/m8-guard-direct-codex-ambient-hooks`.

## Finding and product boundary

The shared `managed-agent-hook-controls` already refuses provider-global hook installation and removal without a proven Ash-owned per-entry ledger. However, callers could bypass those central controls by invoking `CodexHookService.reconcileHooks()`, `refreshManagedScripts()`, or `installRemote()` directly. Reconciliation still writes a managed script and performs inherited real-home/legacy hook cleanup. Refresh could overwrite an existing _unclaimed_ Ash hook script. Remote installation targets `.orca/agent-hooks` and provider trust/config files on a guest host; remote development is explicitly excluded from Ash.

Those three public methods now check `canAshWriteProviderGlobalHooks()` **before deriving paths, reading remote provider data, refreshing scripts, or reconciling existing hooks**. The blocked reconciliation and remote installation return `state: skipped`, `skipReason: ash_ownership_unavailable`; blocked script refresh is a no-op. No environment toggle or general hook-registration feature was enabled. Read-only `getStatus()` remains available. The new policy helper stays colocated with the Codex hook service.

**Not covered or authorized by this change:** direct `install()`, `remove()`, `prepareRuntimeHomeForLaunch()`, runtime-user-hook refresh, WSL home installation, and lower-level trust/edit helpers. Those paths can affect launch homes or provider state and require their own source-grounded safety and lifecycle review. This commit **must not** be interpreted as complete Codex provider-hook isolation. Terminal-first Codex, authenticated PTYs and ordinary local agent startup remain in scope; no provider account or real user home was edited during testing.

## Isolated feature-worktree evidence

- **Red-first:** three tests failed against the old code: direct shared-script refresh overwrote an unclaimed Ash script, startup reconciliation did not report blocked ownership, and direct remote installation did not fail closed before SFTP use. Read-only status inspection remained working. After correction, **4/4** tests passed; fixtures also verify byte-for-byte preservation of synthetic `~/.codex/hooks.json`, `~/.codex/config.toml`, `~/.orca/agent-hooks/codex-hook.sh`, and an unclaimed `~/.ash-ide/agent-hooks/codex-hook.sh`.
- Full TypeScript check: **PASS**; formatting and oxlint on modified code: **PASS**, without weakening max-lines limits.
- Codex runtime-home, trust, reconciliation and WSL legacy tests: **56 passed, 1 skipped across 8 suites**, including the new direct-hook tests.
- Expanded selected Ash security/agent/runtime/packaging suite: **233 passed, 1 skipped across 31 suites** after the final foreign Codex config/TOML fixture assertions. Full typecheck was also rerun on the final feature source and passed.
- Desktop asset build: **PASS**; sandbox preload verified, 1,224-file/three-command CLI closure verified.
- Standalone plain-Node build: **PASS**, **12.78 MB / 8,146 modules**, zero forbidden Electron and `node:sqlite` imports; Node 24.22.1 and native PTY glibc checks. The pinned watcher cache was independently verified against the lockfile SHA-512; normal bundle verification was retained.
- Real four-host local runtime/PTY lifecycle: **PASS**, authenticated original-folder terminal preserved its handle and PID across runtime restart; disposable foreign Orca credential/hook/policy sentinels remained unchanged.
- Real Linux Wayland **source Electron**: **PASS**, private KWin/DBus with disposable HOME/XDG/Ash profile, Ash GUI ready, retained Git/GitLab/GitHub/PTY/runtime/browser/native chat interfaces, real CLI terminal, explicit daemon/runtime stop, zero test-owned processes and unchanged synthetic Orca hook file.
- `/tmp` per-user quota is exhausted on the host although filesystem free-space tools report free capacity. Tests use `TMPDIR=/var/tmp`; the native and Node runtime fixtures provide private temp dirs. No unrelated files were deleted to make space.
- Source/license provenance: **PASS** after the final adapted-source hashes; 33,506 upstream Orca records, 461 Ash adaptations, 8,508 documented exclusions, and unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Remaining acceptance gates

The broader `offline-admission-commands.test.ts` has ten inherited failures reproducible on the unmodified base `main`; they are not counted green. Direct Codex launch-home/trust mutations and legacy cleanup still require further review. This is not real provider-hook consent or interoperability verification, an installed Linux AppImage test, Windows/macOS testing, or full M8 release acceptance. Integrated-main and post-push GitHub CI results must be reported separately.
