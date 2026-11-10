# SEC-04 / AG-05 — per-session managed Claude profile routing pin

## Scope and decision

Fresh, direct, local Claude agent launches can now freeze managed-profile config routing for the lifetime of their native local PTY. The feature only applies when Main sees a host-managed selected account, direct Claude command and launch command, no caller Claude environment override, a local POSIX provider, a new session, a persisted host pane binding, and no shell override, WSL, daemon, remote connection, renderer-delivered command, adoption, or reattach.

System/default selection, unsupported platforms, and noneligible launch shapes do not receive a pin. Once Main captures a selected managed account for an eligible launch, missing or changed profile identity, mismatched prepared auth, final native environment disagreement, or pointer creation failure aborts before native PTY dispatch. Generic interactive Claude terminals keep the selected-host pointer behavior.

## Authority and lifecycle

- Main snapshots the host selected managed account before asynchronous auth preparation. Renderer-provided environment values, launch configuration, and provenance strings do not establish account identity.
- The host verifier checks the canonical managed profile home and its private ownership marker, including physical config-home and marker device/inode identity. The prepared auth result and assembled native spawn environment must agree on that profile home and the host selected-pointer path.
- After local environment construction and shell startup preparation, a final pre-dispatch guard rejects the PTY if config home, injected config home, or pointer path changed.
- Main creates a random opaque pointer under Ash `userData/claude-profiles/session-pins` with a private `0700` directory, `0600` file, `O_EXCL`, `O_NOFOLLOW`, and a synced contents write. Only the pointer environment variable for the eligible new local Claude PTY is changed.
- The lease is bound to the PTY ID and incarnation returned by local native spawn. Pre-spawn failure and unspawned adoption/reattach paths remove their unused pin. A GUI close/detach does not remove a pin while the PTY is active. Only a matching physical PTY exit removes it; a changed or uncertain path is preserved.
- If native PTY dispatch throws after an attempt, the result is ambiguous; the pin is retained even if a later fallback returns a PTY, because that generation cannot account for the failed call. There is no time-based cleanup for this case.
- A process or machine crash can leave an orphan pin. No time-based or GUI-close garbage collection is enabled because neither proves that the owning process generation has ended.

## Evidence limits

This establishes **config routing only**. It does not prove that a Claude process authenticated to the selected provider account, identify a provider session, or correlate a `SessionStart` hook. `accountEvidence` remains `missing`; this receipt must not authorize SessionStart, hook attachment, or provider-global writes. `canAshWriteProviderGlobalHooks()` remains `false`.

The private pointer protects against other OS users and detects replacement before cleanup. A same-OS-user process can still tamper with Ash-owned files; this work does not claim a boundary against that actor or claim race-free filesystem transactions against a noncooperating process with the same user identity.

## Verification

- `claude-session-profile-routing-pin.test.ts`: A→B selected-account switch, next-launch B, forged and replaced marker refusal, symlinked and plain-replaced profile-home refusal, failed/adopted cleanup, detach retention, matching-generation exit cleanup, replacement-file preservation, and foreign settings sentinel.
- `claude-session-profile-routing-pin.node-pty.test.ts`: disposable host profile homes and executable fake Claude programs read the same A and B environment snapshots passed to live native PTYs. The test invokes A again after the global pointer switches to B while A's PTY remains alive, then checks the separate B launch. The fixture makes no provider network call and leaves a foreign `.claude/settings.json` sentinel unchanged.
- Foundation CI runs both focused pin tests alongside the existing SEC-04 shell-entry, PTY lifecycle, adoption, and hook-gate suites.
- The full foundation-focused Vitest selection passed: **38 files, 340 tests**.
- `pnpm run typecheck` passed for Node and renderer TypeScript projects.
- Native and type-aware Oxlint passed with warnings denied; Oxfmt write and check passed for changed TypeScript files.
- Source provenance passed: 33,506 upstream records, 219 Ash edits, 8,260 documented removals.

The numbered source pack 04/09/11/13 was not present in this worktree search. The implementation was cross-checked against the in-repo SEC-04 shell-entry witness, PTY spawn-commit evidence, launch-bridge, account-bound overlay receipt, and live-PTY adoption notes. No source-pack or Orca reference files were edited.

## Independent ChatGPT acceptance checks — November 10, 2026

The integrator independently consulted the attached authoritative sources `04_RUNTIME_ARCHITECTURE.md`, `09_ASH_IDE_ENGINEERING_STANDARD.md`, `11_ACCEPTANCE_AND_TEST_EVIDENCE.md`, and `13_SECURITY_PRIVACY_RELEASE_AND_MIGRATION.md`, including original-account preservation on selected-account switches (AG-05), fallback without hook integration (AG-07), and foreign provider hook protection (SEC-04). They are attached to the Project, not duplicated into the repository.

**A held-out security defect was found before integration:** if an Ash-private `session-pins/*.route` file disappeared or its contents were replaced, the original shell wrapper read an empty/changed value and could silently invoke Claude with System-default or another managed profile. This violated the fail-closed account-freeze requirement. The scoped POSIX (Bash/Zsh) and Fish wrappers now refuse a pinned route unless the file names the exact injected managed config home. Normal interactive terminals using the mutable `selected-host` pointer keep their original System-default fallback. The implementation does not claim to defeat same-user tampering; the guard reduces accidental and certain malicious misrouting, not OS-user-level trust compromise.

Independent negative tests run a disposable fake Claude executable through the **actual POSIX shell function** (not just env-string assertions). They verify A remains A after shared selection changes to B; B's independent launch routes to B; missing and mismatched private pins fail with exit code 1 **without invoking the stub** (verified by a separate sentinel); the generic interactive selected-host pointer can still fall back. Fish source was updated analogously but a Fish executable was not available for direct local execution; dedicated Fish runtime acceptance remains unverified.

**Independently observed local verification on the final hardened source:**

- GitHub foundation workflow's exact 38-file selection: **340/340 tests PASS**, twice during the acceptance cycle, including a rerun after the missing-pin hardening.
- Broader native Claude, local PTY, provider hook, account and runtime tests: **228/228 tests PASS across 27 suites** after the hardening. Native Claude cases use disposable test homes and a loopback fake provider, not a real login.
- Held-out pin + real shell executable regression: **9/9 tests PASS across two suites**; focused PTY/commit/adoption integration: **62/62 tests PASS across six suites** before the final shell hardening.
- Full Node and renderer TypeScript projects: **PASS** after shell hardening. Source-provenance verifier: **PASS**, 33,506 pinned upstream records, **220 Ash adaptations**, 8,260 documented removals and intact MIT license attribution; the changed upstream shell wrapper now has an explicit source hash entry.
- Oxfmt and native/type-aware Oxlint (`--deny-warnings`) for the altered shell wrapper and pinned routing tests: **PASS**. Ash CLI and Electron desktop bundle builds: **PASS**, with existing chunk-size and ineffective dynamic-import warnings.
- `git diff --check`: **PASS**. No live user repository, provider credential, actual Claude login, global hook, or existing PTY was modified by verification.

**External gates:** an independent GPT-6 Luna/xhigh read-only security assessment and GitHub CI on the exact feature commit must be observed before accepting this milestone on `main`. Nothing above is authenticated provider-account identity, actual root `SessionStart` provenance, or packaged Wayland/X11/AppImage acceptance. AG-05, AG-07, SEC-04, and full M2 acceptance **remain open** pending real process and hook integration proof.

## Independent security findings and post-review corrections

The first independent GPT-6 Luna/xhigh read-only security reviewer rejected production integration for two P2 defects despite successful initial feature CI. These were corrected on the isolated feature branch before any merge:

1. **Verified physical account profile could change between pin issuance and native dispatch.** A synchronous pre-`node-pty.spawn` guard now checks all profile-home pathname components for symlinks, rechecks the original private home device/inode, and reopens the private marker with `O_NOFOLLOW | O_NONBLOCK` to compare single-link ownership, size-bound contents digest, physical marker device/inode, and home identity again without asynchronous interleaving. Tests replace the marker with identical bytes but a new inode, and separately replace an ordinary home directory at the same pathname **after** issuing a valid pin. Both are refused before native spawn. The injected Bash/Zsh/Fish session-pin routing also refuses an unavailable home; unlike generic interactive terminals it must not create an unverified replacement directory.
2. **Cancellation after successful native creation but before normal PTY activation could leave an unobserved pin.** The provider now subscribes to the exact returned PTY's physical exit *before* killing a canceled native process, and invokes the pin's generation-fenced cleanup only upon that exit. If observation cannot be established it conservatively retains the pin. The new dedicated real `node-pty` test aborts precisely in `onLocalPtySpawnReturned` and verifies that a matching native PTY exit was observed. The original shell/agent startup behavior remains unchanged for all other routes.

The new cancellation test is registered in foundation CI. **12/12** focused regression tests passed after these corrections, full Node/renderer TypeScript and both Oxlint modes passed, and source provenance was updated for the adapted local PTY spawn implementation. A second independent security review and successful feature/main CI on the final commits are still required. These checks are filesystem routing and PTY lifecycle evidence, not authenticated Claude login or root hook provenance.

## November 10 continuation: verification and cross-platform boundary

The implementation was independently inspected again after the two corrections. The GPT-6 Luna/xhigh read-only reviewer found no further actionable P1/P2 defect in the **Linux/macOS POSIX** pinning path, but identified a real **Windows gap**: host-local PowerShell Claude launches still use the mutable selected-account pointer. Changing A to B before startup-command delivery can therefore launch B instead of the originally selected A. This does **not** meet the unrestricted cross-platform AG-05 requirement. Full AG-05/SEC-04 acceptance and release readiness remain **NO-GO**, and Windows must not be labeled account-frozen. The current feature is only an incremental POSIX implementation, not an exception to the approved product contract.

The coordinator also separated private pin storage and physical profile verification into the cohesive `claude-session-profile-routing-pin-storage.ts` module, retaining the original public pin API and native lifecycle wiring. This fixes the previously committed oversized-module lint failure without suppressing any rule. One inherited test array-type style error and one inherited type-aware optional-chain error were also corrected. No provider files or global hook configuration were touched.

After that extraction, **39/39 foundation files and 343/343 tests passed**, along with full `pnpm run typecheck`, native and type-aware Oxlint with warnings denied on the seven affected TypeScript files, Oxfmt check, provenance (33,506 upstream records, 220 adapted files, 8,260 documented removals), and `git diff --check`. Before the extraction, the real native cancellation case additionally passed five consecutive independently invoked runs. No real Claude authentication, PowerShell-on-Windows launch, GUI/AppImage, or post-push GitHub CI was exercised by these checks. Integration into `main` is not implied by this evidence.
