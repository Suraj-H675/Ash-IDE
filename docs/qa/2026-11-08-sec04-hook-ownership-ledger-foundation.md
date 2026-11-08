# SEC-04 — Ash provider-hook ownership ledger foundation

- **Date:** 2026-11-08 (Asia/Kolkata)
- **Implementation:** `src/main/agent-hooks/ownership/ash-hook-ownership-plan.ts` and `ash-hook-ownership-store.ts`.
**Scope:** POSIX-style Claude-compatible JSON command hook **planning** and **Ash-private claim storage**. No live provider-file installer is exposed or enabled. Codex TOML, Windows hook forms, other agents and native provider acceptance remain out of scope.

## Ownership and rollback design

- Ash generates a UUIDv4 per proposed hook and a POSIX command prefix `ASH_IDE_HOOK_OWNER=<uuid>`. The private ledger stores only an Ash-owned claim identifier, target settings path, event, full-entry SHA-256 digest and `prepared` / `installed` state. It does not copy a provider's entire configuration or credentials into Ash's ledger.
- Before a future installer writes anything, it must persist the claim as `prepared`. Only after observing the exact matching hook entry in the provider file may it confirm the claim as `installed`. On an interrupted installation, it can safely abandon an unmaterialized claim or propose removal of an exact, still-prepared entry.
- Removal plans require the **same provider home**, a single matching owner marker, and the unchanged full entry digest. Duplicate or moved markers, altered commands, extra hooks in the same definition, missing records, wrong targets, malformed nodes and unknown ledger versions cause **conflicts**, not deletion. Foreign entries and unrelated provider settings are retained.
- The ledger is stored only under Ash userData: `provider-hook-ownership/claims.v1.json`, using a private directory (mode `0700` on POSIX), file mode `0600`, a writer-exclusive lock file, temp-file-and-rename publication, and a compare-and-swap revision. Invalid or symlinked storage is rejected; insecure preexisting permissions are **not** silently changed.
- The ledger does **not** grant hook-installation permission: `canAshWriteProviderGlobalHooks()` remains `false`, and startup/settings/Claude profile configuration still never call the new planner to modify actual provider files.

## Evidence

`ash-hook-ownership-plan.test.ts` and `ash-hook-ownership-store.test.ts` exercise real **disposable** settings JSON files under `/tmp` and Ash profile roots. Tests include staged/confirmed/removed lifecycle, a user/Orca hook on the same event, a later foreign hook edit, interrupted install and safe abandon, stale ledger revision, duplicate/moved markers, modified commands, invalid file schema, symlinks, corrupt records, insecure permissions, and an existing writer lock. No existing home/account or global provider configuration file is used.

The prior AG-07 no-hook native Claude test and CI foundation suite are unchanged. The expanded CI suite includes these two files. Record the observed focused test count, typecheck, bundle checks and GitHub CI result in the milestone report; do not infer a Windows or packaged runtime pass from Linux source tests.

## Remaining SEC-04 gates

1. Build and validate a **cross-process guarded provider-file writer**, including locks/checks against external provider edits between read and atomic write. Recover from crash at each state transition, and avoid changing provider config before a recoverable claim is durable.
2. Verify actual provider acceptance of Ash-owned command markers and safe behavior on disabled/unavailable status hooks; design separate, provenance-safe Codex TOML and Windows-specific adapters without using Orca paths.
3. Test installing, reverting and uninstalling Ash beside Orca with existing foreign entries and deliberate provider edits; verify real Claude/Codex status through authenticated turns only under authorized test conditions.

**Acceptance:** ledger primitives and disposable-file safety tests implemented; SEC-04 end-to-end reversible global hook ownership and M2 hook-backed provider status **not yet accepted**. Keep the production write gate closed.
