# SEC-04 — guarded provider JSON transactions (isolated foundation)

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Implementation:** `src/main/agent-hooks/ownership/ash-provider-json-guard.ts`, `ash-provider-json-recovery.ts`, and `ash-provider-hook-transaction.ts`
- **Scope:** POSIX, Claude-compatible JSON settings files. Codex TOML, Windows provider integrations, installed Ash distributions and authenticated provider status remain unverified.
- **Release status:** provider-global hook installation **disabled**; these experimental functions have no application launch/settings/account callsite.

## Guarded publication protocol

An Ash-owned claim must first be persisted as `prepared` in the private ledger (`provider-hook-ownership/claims.v1.json`). The experimental transaction verifies the exact claim and the original provider-file contents, then durably writes a private, mode-`0600` receipt containing only the claim ID, target path and old/new SHA-256 digests. The receipt contains **no credentials or provider JSON content**.

The file writer takes a uniquely Ash-named, exclusive `wx` lock adjacent to the settings file. It rejects malformed JSON, symlinked/hardlinked files, unowned or world-writable parent directories, oversized content, stale raw snapshots and pre-existing guard files. An existing settings file is moved to a recoverable Ash-held name, verified against its original inode/content and replaced via a **no-overwrite hard link**; a missing file is created with the same no-overwrite publication primitive. The staged file uses a claim-derived path so recovery can validate and clean even the interrupted **two-hardlink** state (stage and published target share an inode). Existing file permissions are preserved; new files use private permissions. The provider and private-ledger directories are fsynced at relevant publication boundaries.

After publication, the adapter verifies the published file and confirms the private ownership claim as `installed`. Only then does it remove the receipt. If a failure occurs, the prepared claim and receipt survive so recovery can evaluate exact on-disk state without guessing what belongs to Ash.

## Interrupted write and foreign-edit behavior

Recovery requires an existing, validated private receipt and the matching Ash claim. It uses the recorded digests and owner ID to distinguish (1) an original file held before replacement, which can be restored **without overwriting an existing target**, (2) an exactly published replacement, which can be confirmed, or (3) missing, modified, or ambiguous state, which is left untouched with a conflict. Unrecognized third-party edits, stale lockfiles, and unfamiliar held files are never silently cleaned or overwritten.

The new tests create **only disposable** provider profiles beneath `/tmp` and simulate interrupted publication by constructing its exact persisted file/receipt state. They verify preserving unrelated Orca-like hooks, later foreign edits, stale plan snapshots, lock contention, symlink/hardlink refusal, private receipt permissions, initially missing settings, and rollback/confirmation of prepared claims. The prior ownership-ledger tests remain in the CI suite.

## Limits and open safety gates

- These tests reproduce crash **filesystem states**; they do **not** demonstrate a real OS process being killed mid-write, automatically reclaim a stale lock after `SIGKILL`, or prove interoperation with an external provider that modifies files independently. The Ash lock is advisory; an uncooperative writer that changes an already-open inode can still race a swap. Node's ordinary `rename` does not provide no-replace semantics for the held-file destination, so a foreign creation in that narrow check-to-rename window also requires additional platform-level protection before live use. Full lossless cross-application concurrency is **not yet accepted**.
- The current guarded transaction supports **install/recovery only**, not a fully journaled hook removal transaction or a user-approval UI. The existing pure removal planner is not a provider-file removal implementation.
- No existing account files were accessed. The global `canAshWriteProviderGlobalHooks()` policy still returns `false`. Real Claude/Codex provider acceptance, recovery after actual process termination, Windows packaging, and a complete reversible owned-hook uninstall remain future milestones.

**Acceptance decision:** isolated guarded POSIX JSON transaction primitives are testable and integrated as an inert foundation; **SEC-04 and AG-07 remain partially verified**.
