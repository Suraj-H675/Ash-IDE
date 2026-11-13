# M8 — Block unowned direct Codex hook removal

**Date:** 2026-11-13 (Asia/Kolkata)

**Base:** canonical `main` `4ddccf097b7f08f36edfe038c64880e57592877c`, clean and synchronized with `origin/main`; [GitHub Actions 43361433989](https://github.com/Suraj-H675/Ash-IDE/actions/runs/43361433989) concluded **success**. Feature branch `fix/m8-guard-direct-codex-removal` in an isolated worktree.

## Security finding and change

Ash's central hook controls refuse provider-global modification without verified per-entry ownership, but `CodexHookService.remove()` still called the inherited cleanup directly. That implementation reconstructs managed hooks and trust, strips commands using script-filename matching, and can remove entries from the **real provider `~/.codex` home** and legacy Orca state. Matching an inherited filename is not evidence of Ash ownership. Even a direct remove on a fresh profile could create managed runtime-home directories before proving ownership.

`CodexHookService.remove()` now checks the existing **fail-closed** `blockedCodexAmbientHookMutation()` policy before resolving the managed home or entering the trust mutation queue. A denied removal returns `state: skipped`, `skipReason: ash_ownership_unavailable` and performs no cleanup. The change does not alter Codex terminal launch, runtime-home installation, read-only hook status, or the existing central gate. There is no opt-in or environment toggle enabling provider-global removal.

To retain deep tests of the inherited cleanup while refusing production calls, seven historical suites now invoke a **test-only lower-level cleanup helper**. The helper asserts that **both** the Ash data root and the mocked system home are physically beneath the disposable OS temporary root before allowing a historical cleanup test. It retains the existing trust-queue ordering, hash lookup and cleanup assertions; no real provider-home path can be used intentionally through that helper. These tests exercise cleanup mechanics, **not** authorization for Ash to use broad-match cleanup in production.

## Feature-worktree evidence

- **Red-first:** two public removal tests failed against the old direct service. One proved direct removal did not return an ownership denial; the other checked that foreign script-name matches, an unrelated hook, and provider settings were preserved. Both passed after the guard; the direct Codex ambient service suite passed **6/6**.
- Public-denial and historical legacy cleanup: **34 passed, 1 skipped across 8 suites**, including a negative check that the test-only helper rejects a non-disposable data root. Historical removal assertions were retained rather than deleted or weakened; their execution is now deliberately limited to disposable fixtures.
- Full workspace TypeScript verification: **PASS**. Oxfmt/Oxlint: **PASS** for modified production/test files. Existing max-lines lint limit preserved.
- Expanded selected Codex configuration, hooks, trust, provider-isolation, runtime control and distribution tests: **318 passed, 4 skipped across 63 suites** on completed feature source; full TypeScript check also rerun successfully.
- Desktop asset build: **PASS**; sandbox preload verified and 1,224-file/three-command CLI closure checked.
- Standalone Node build: **PASS**; Node 24.22.1, **12.78 MB / 8,146 modules**, zero forbidden Electron or `node:sqlite` imports. Native watcher cache SHA-512 was independently checked against `pnpm-lock.yaml`; regular integrity checks stayed enabled.
- Real four-host plain-Node runtime/PTY: **PASS**, original-folder terminal handle and PID retained across runtime stop/restart; synthetic Orca credential/policy/hook sentinels preserved.
- Native **Linux Wayland source Electron**: **PASS** under a private KWin/DBus, disposable HOME/XDG and Ash profile. GUI DOM ready, retained GitHub/GitLab/PTY/runtime/native chat/browser interfaces, authenticated CLI terminal created, Ash-only keybindings persisted, daemon/runtime shutdown receipts passed, **zero** test-owned processes remaining, foreign Orca hook bytes unchanged.
- Pinned Orca source and MIT provenance: **PASS**, 33,506 upstream records, 469 adapted Ash hashes, 8,508 documented exclusions, unchanged MIT license SHA-256 `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`.

## Open boundaries

The inherited `removeCodexHooksExclusively()` and related legacy helpers remain in the tree. They must not be exposed as production entrypoints until Ash-specific per-entry provenance and guarded transactions replace broad-match behavior. Direct Codex `install()`, runtime-home launch preparation, trust promotion and WSL paths also remain separate pending audits. Normal terminal-first Codex remains available even with status hooks degraded. No real provider account or Orca profile was read or changed in this work. The previously observed account-suite initialization defects and ten inherited offline CLI test failures are not accepted as passing. Installed AppImage, Windows/macOS native acceptance, real-provider consent and full M8 release acceptance remain open. Integrated-main test results and matching GitHub CI must be observed separately.
