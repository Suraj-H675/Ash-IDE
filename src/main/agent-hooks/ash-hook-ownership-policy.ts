/**
 * SEC-04: Provider-global hook installation is not yet supported by Ash.
 * An Ash-owned per-entry provenance ledger and reversible cleanup are required
 * before this policy can enable writes, even on explicit settings changes.
 * This gate does not block terminal agents or non-mutating status observations.
 */
export function canAshWriteProviderGlobalHooks(): boolean {
  return false
}
