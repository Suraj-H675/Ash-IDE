# M8 — Fail closed when Codex native project distrust cannot reach Ash

**Date:** 2026-11-13 (Asia/Kolkata)
**Base:** `main` at `86547879c2882da4dbc891722e2d718e58ff17a3` (previous CI run 43373887930: success).
**Worktree:** `fix/m8-codex-trust-revocation-failclosed` in `/home/suraj/projects/Ash-IDE-worktrees/m8-codex-native-settings-boundary`.

## Finding and correction

During a refused provider-global settings write-back, Ash retains edits made inside its managed Codex home. The existing narrowed project-trust synchronization replaced matching runtime project entries with native `untrusted` entries, but silently omitted a native project revocation if Ash had no matching runtime project section. It also logged a guarded runtime write failure or concurrent-edit conflict and continued launch preparation with the old trusted state.

The revocation merge now adds explicitly revoked native projects absent from the runtime while retaining unrelated pending local settings. Repeated sync does not append duplicates. If native project distrust cannot be read or a needed runtime change cannot be atomically published, the refused-writeback sync throws an actionable error instead of reporting success and permitting the caller to use stale managed trust. The existing write-back warning is still recorded, including when the sync throws. Native `~/.codex/config.toml` remains read-only; positive native write-back tests remain restricted to disposable fixtures with an explicit mocked ownership gate.

## Evidence

- **Red-first:** two new regressions failed against the previous implementation: native `untrusted` project absent from Ash's runtime was omitted, and an injected compare-and-swap publication conflict did not refuse launch-time synchronization. Both pass after the correction. The failure test also proves a later retry applies distrust without losing the pending model edit or modifying native config/baseline; the absent-project test proves idempotence.
- Settings/runtime-home focused suite: **62 passed across 12 test files**.
- Expanded Codex settings, hooks, trust and runtime-home sweep: **305 passed, 15 platform-specific skips across 62 files**.
- Additional WSL/home-routing fixtures: **18 passed across six files**, with no real WSL binary on Linux.
- Node TypeScript check: **PASS** (`node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json --composite false`). Targeted Oxlint, Oxfmt and `git diff --check`: **PASS**.
- All native and Ash homes in changed regressions were disposable. No provider credentials or real user provider home was read or modified by these tests.

## Remaining boundary

These checks establish the synchronous refused-writeback boundary and its callers, not an independently observed signed-in Codex launch or GUI error. If the earlier promotion pass itself fails before a refused-writeback plan is available, its separate existing mirror-stall behavior still requires a full launch-admission trust review. Native config changes racing after the snapshot and additional WSL/native-provider mutation paths also remain separate M8 security gates. CI for this follow-up commit, desktop packaging and real-provider verification have **not** been run as of this evidence entry. The prior base commit's successful CI is not evidence for this new commit.
