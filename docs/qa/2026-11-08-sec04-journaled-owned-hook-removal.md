# SEC-04 — journaled selective removal of Ash-owned provider hooks

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Implementation:** `ash-provider-hook-removal.ts`, shared `ash-provider-transaction-receipt.ts`, and the existing POSIX Claude JSON guard, ownership planner and private ledger
- **Scope:** disposable POSIX Claude `settings.json` fixture files. **No existing provider account or provider-global settings were read or modified.**
- **Release state:** experimental and disconnected. `canAshWriteProviderGlobalHooks()` still returns `false`. Neither the installer nor remover is called by Ash startup, account selection, settings, or GUI shutdown.

## Transaction and recovery contract

1. Require a privately persisted **installed** Ash claim with the correct provider home, event, unique owner marker, and unchanged full-definition SHA-256. Do not remove by command similarity, script path, or event name alone.
2. Construct a new provider JSON state containing only the removal of that verified Ash entry. Preserve unrelated Orca-like, unknown and provider-managed hook entries and other configuration fields.
3. Before changing the provider file, durably create an Ash-private mode-`0600` receipt with `action=remove`, claim ID, a fresh UUID operation ID, target path, ownership-definition digest, and the previous/new settings digests. The receipt stores **no provider configuration, credentials, or tokens**.
4. Reuse the POSIX-only guarded write: Ash-cooperative exclusive lock, expected-raw-content check, staged and held paths tied to the operation ID, no-overwrite publication, and a recoverable previous file. Confirm the exact published digest, remove the ownership claim with a compare-and-swap ledger revision, then delete the receipt.
5. On recovery, require a valid removal receipt and a matching Ash claim (or an already-finalized ledger state). If the provider write never published, restore/keep the original and retain installed ownership. If the exact removal published, finalize removal of **only** its matching claim. Foreign edits, ambiguous or corrupted state, unexpected locks, and mismatched claims are refused without a guessed cleanup.

## Test evidence

`ash-provider-hook-removal.test.ts` uses fresh mode-`0700` disposable Ash/provider roots and mode-`0600` JSON. It verifies normal selective deletion preserving unrelated hooks/settings, unknown claim refusal, modified and duplicated hook marker refusal, concurrent Ash lock protection, an interrupted pre-publication intent, held-file restoration, published-file recovery, ledger-saved/receipt-present recovery, foreign edits after publication, an independently launched process making a stale snapshot invalid, and invalid receipt action/content. The previous guarded transaction and ownership suites remain active in CI.

An actual short-lived **Node child process was terminated with `SIGKILL`** after moving a disposable settings file to an Ash-held location; the pending removal receipt and provider file were then recovered, with the original file and installed ownership claim preserved. This is real process termination at a **fixture-controlled filesystem boundary**; it does not demonstrate killing the production transaction function at arbitrary instructions or complete power-loss durability.

## Remaining acceptance gates

- Provider native hook compatibility and real authenticated status/turn recovery are **not** verified.
- A simultaneous noncooperative provider process can still race Ash's advisory lock and filesystem operations. Atomic guarded `rename`-without-overwrite and all possible external `in-place` edits are not fully proven. Do not enable writes based solely on these fixture tests.
- Crash-kill the **actual guarded transaction** at multiple instruction boundaries, reconcile stale locks without taking over live processes, and verify concurrent writer survival under stress before SEC-04 acceptance.
- Design and test separately for Codex TOML, Windows provider hook semantics/ACLs, provider-native approval behavior and co-installed Orca; do not infer cross-platform correctness from POSIX JSON fixtures.

**Acceptance:** selective journaled removal and controlled interruption behavior are source/fixture verified; **SEC-04, AG-07, and full M2 remain partially accepted**. Keep the production hook-write gate closed.
