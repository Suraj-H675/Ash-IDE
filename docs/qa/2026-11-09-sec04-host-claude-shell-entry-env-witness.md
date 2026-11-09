# SEC-04 — local Claude shell-entry environment witness

- **Date:** 2026-11-09 (Asia/Kolkata)
- **Result:** main-only, bounded in-memory shell-entry observation attached to a committed fresh local PTY.
- **Acceptance:** AG-05, AG-07, and SEC-04 remain **open**.
- **Provider-global hook-write gate:** `canAshWriteProviderGlobalHooks()` remains `false`.

## Observation boundary

For a direct fresh host Claude candidate, the local PTY provider samples the final `CLAUDE_CONFIG_DIR` value immediately before and after each successful native `node-pty.spawn` call. This is the shell-entry environment. A successful fallback is labeled separately and reports the fallback's final env after fallback-shell mutations. A failed primary or fallback attempt never becomes the recorded shell observation.

The observation stores only the PTY id, incarnation id, attempt kind, value status, and SHA-256 of a non-empty config-home value. It compares that fingerprint with the config directory prepared for the launch only when the caller supplied no config-home or Claude profile-pointer override, the selected account setting stayed stable, and the Ash `selected-host` pointer stayed readable and unchanged across preparation and native spawn. A missing or empty value, a mismatch, an explicit caller override, or changed/unreadable selection state remains visible as a status.

This is a consistency observation. It does not establish that Claude authenticated, that a shell startup file left the value unchanged, or that the CLI used the same directory after process startup. Shell rc files and the Claude CLI can change environment state after this shell-entry boundary. Account evidence stays `missing`: this milestone does not independently verify the managed profile directory and private ownership marker, and it does not treat the mutable selector or `profile:<id>` provenance as account authority. No reader may use this witness to authorize hooks or launch behavior.

The receipt is main-process memory only, keyed by the committed PTY id and incarnation. It is recorded after the existing pane binding commit, removed on matching PTY exit or retirement, and included in the existing bounded evidence store. No renderer, RPC, persistence, or log payload was added. The provider environment itself, cookies, tokens, raw config-home paths, and provider settings are not stored. The caller-supplied launch token remains represented only by the existing non-secret SHA-256 hash.

## Coverage

The focused tests exercise:

- A real `LocalPtyProvider` and production controller spawn through native `node-pty`; the test hashes the actual `options.env` at the `node-pty.spawn` call boundary, then delegates to the original native function. It does not inspect the process environment after shell startup.
- Primary-to-fallback behavior with a fallback-only `CLAUDE_CONFIG_DIR` mutation and a native node-pty child.
- Missing, empty, inherited, matching, and mismatching config-home values; caller override refusal; selector and `selected-host` pointer changes before and during native spawn; symlink replacement of the Ash pointer file.
- Receipt privacy, unchanged foreign Claude settings, missing account evidence, PTY/incarnation binding, bounded retention, exit cleanup, and the disabled provider-hook write gate.

The code does not verify the physical identity of the managed profile directory or marker. A profile-directory symlink or marker replacement therefore cannot upgrade `accountEvidence`; this milestone makes no inode, authenticated-login, or provider-account claim.

No provider account, provider configuration, global setting, Orca source checkout, or release was changed. No hook was attached.

## Final local integration verification — 2026-11-09

The implementation Codex agent completed on `feat/sec04-native-shell-env-witness` without committing or pushing. Independent acceptance examination found that the initial native observer still received a live, mutable, full environment object. This was fixed before integration: it now receives an `Object.freeze`-protected copy containing only `CLAUDE_CONFIG_DIR` and `ORCA_CLAUDE_PROFILE_POINTER` (case-insensitive matching for Windows), and both synchronous exceptions and asynchronous rejections are isolated from the real `node-pty.spawn` call. Constructing that safe copy is also inside the failure-isolation boundary. A malicious observer can no longer mutate the native environment via the observation API, and unrelated auth/token environment keys are not passed to it.

Two independent regression cases exercise malicious synchronous mutation and throw, plus rejected asynchronous observation. Both require the child-spawn environment to remain unchanged; the real native fallback test also verifies the successful fallback's final environment. All tests use disposable synthetic values. The original application’s installed provider accounts, hooks, credentials, and user repositories were not changed.

Independently executed acceptance checks on the feature worktree:

- **218/218 tests across 25 suites PASS**, including new shell-entry witness/real node-pty fallback and observer isolation, PTY commit/adoption/daemon-routing/reattach, account-switch preservation, native synthetic Claude Stop/SessionStart/resume, foreign hook coexistence, and provider-global hook disable.
- **Full Node/renderer TypeScript projects PASS** using the repository default typecheck runner.
- **Oxfmt on 11 changed source/test files PASS**; Oxlint native and type-aware with `--deny-warnings`: **0 errors/0 warnings**.
- **Pinned upstream source attribution PASS**: 33,506 upstream records, 217 Ash adaptations, 8,260 recorded removals; MIT license unchanged. The new adjusted source hash was recalculated after the observer-isolation fix.
- **Ash CLI (`ORCA_CLI_BUILD_COMPILER=tsrs`) and Electron desktop bundle PASS**; Electron reports pre-existing oversized-chunk and ineffective-dynamic-import warnings. The successful bundle is not physical Wayland/X11 or packaged-AppImage acceptance.
- `git diff --check`: PASS. No real provider login, provider-global config, foreign hooks, or live user PTY was used.

The independently assigned GPT-6 Luna/xhigh follow-up reviewer must examine this final observer-isolation correction before the feature can be accepted. A GitHub foundation workflow must pass on the exact committed feature SHA and on integrated `main` before final CI-accepted status. SEC-04, AG-05, AG-07, full M2, authenticated Claude account identity, and reliable root-hook-to-process proof **remain open**.
