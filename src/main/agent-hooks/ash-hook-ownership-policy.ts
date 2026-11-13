/**
 * SEC-04: Provider-global hooks and settings writes are not yet supported by Ash.
 * Hook writes need per-entry provenance and reversible cleanup. Settings writes
 * need a separate ownership proof. Neither gate blocks terminal agents or reads.
 */
export function canAshWriteProviderGlobalHooks(): boolean {
  return false
}

/** Provider-global Codex settings remain read-only until Ash can prove ownership. */
export function canAshWriteProviderGlobalSettings(): boolean {
  return false
}
