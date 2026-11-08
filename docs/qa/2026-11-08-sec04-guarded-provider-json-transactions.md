# SEC-04 — guarded provider JSON transactions (isolated foundation)

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Implementation:** `src/main/agent-hooks/ownership/ash-provider-json-guard.ts`, `ash-provider-json-recovery.ts`, and `ash-provider-hook-transaction.ts`
- **Scope:** POSIX, Claude-compatible JSON settings files. Codex TOML, Windows provider integrations, installed Ash distributions and authenticated provider status remain unverified.
- **Release status:** provider-global hook installation **disabled**; these experimental functions have no application launch/settings/account callsite.

## Guarded publication protocol

An Ash-owned claim must first be persisted as `prepared` in the private ledger (`provider-hook-ownership/claims.v1.json`). The experimental transaction verifies the exact claim and the original provider-file contents, then durably writes a private, mode-`0600` receipt containing only the claim ID, target path and old/new SHA-256 digests. The receipt contains **no credentials or provider JSON content**.

The file writer takes a uniquely Ash-named, exclusive `wx` lock adjacent to the settings file. It rejects malformed JSON, symlinked/hardlinked files, unowned or world-writable parent directories, oversized content, stale raw snapshots and pre-existing guard files. An existing settings file is first linked to a recoverable Ash-held name with **no-overwrite `link()`**, both references are checked against its original inode/content, and only then is the original pathname unlinked. A replacement is published via a second **no-overwrite hard link**; a missing file is created with the same no-overwrite publication primitive. The staged file uses a claim-derived path so recovery can validate both interrupted **two-hardlink** states (original + held backup before removal, and stage + published target). Existing file permissions are preserved; new files use private permissions. The provider and private-ledger directories are fsynced at relevant publication boundaries.

After publication, the adapter verifies the published file and confirms the private ownership claim as `installed`. Only then does it remove the receipt. If a failure occurs, the prepared claim and receipt survive so recovery can evaluate exact on-disk state without guessing what belongs to Ash.

## Interrupted write and foreign-edit behavior

Recovery requires an existing, validated private receipt and the matching Ash claim. It uses the recorded digests and owner ID to distinguish (1) an original file held before replacement, which can be restored **without overwriting an existing target**, (2) an exactly published replacement, which can be confirmed, or (3) missing, modified, or ambiguous state, which is left untouched with a conflict. Unrecognized third-party edits, stale lockfiles, and unfamiliar held files are never silently cleaned or overwritten.

The new tests create **only disposable** provider profiles beneath `/tmp` and simulate interrupted publication by constructing its exact persisted file/receipt state. They verify preserving unrelated Orca-like hooks, later foreign edits, stale plan snapshots, lock contention, symlink/hardlink refusal, private receipt permissions, initially missing settings, and rollback/confirmation of prepared claims. The prior ownership-ledger tests remain in the CI suite.

Additional SEC-04 alias-path regressions establish that validating only the *immediate* settings parent is insufficient: a symlink in an earlier path component could silently redirect reads, writes, and recovery to another private provider home. The guard now checks every ancestor directory with `lstat` before either operation. Both new tests failed before the correction and passed after it; they never used a real provider profile.

## Limits and open safety gates

- Later SEC-04 tests now kill the **actual** disposable guarded transaction process and reclaim only a verified dead-writer lock; see `2026-11-08-sec04-journaled-owned-hook-removal.md`. A new no-overwrite backup regression first demonstrated that `rename()` could clobber a foreign held file inserted after the initial existence check. It now rejects that collision, preserving both the foreign file and the existing provider settings. A second regression checks that in-place provider edits during the linked-backup interval are preserved rather than overwritten. The Ash lock remains advisory and `link()` followed by `unlink()` is **not** an atomic compare-and-delete: a noncooperating writer can still replace the original pathname between checks and unlink. Full lossless cross-application concurrency is **not yet accepted**.
- The ancestor checks are **preflight validation**, not an atomic open-relative-to-a-trusted-directory protocol. Symlink swaps after validation are still possible in an adversarial concurrent filesystem; do not mistake the new regression coverage for protection against that race.
- The current guarded transaction supports **install/recovery only**, not a fully journaled hook removal transaction or a user-approval UI. The existing pure removal planner is not a provider-file removal implementation.
- No existing account files were accessed. The global `canAshWriteProviderGlobalHooks()` policy still returns `false`. Real Claude/Codex provider acceptance, recovery after actual process termination, Windows packaging, and a complete reversible owned-hook uninstall remain future milestones.

**Acceptance decision:** isolated guarded POSIX JSON transaction primitives are testable and integrated as an inert foundation; **SEC-04 and AG-07 remain partially verified**.
