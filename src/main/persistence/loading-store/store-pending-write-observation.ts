import type { StoreRuntimeState } from './store-runtime-state'

/**
 * One local Store can prove that a write is pending, but can never prove that
 * every runtime process, browser, extension or provider has drained its writes.
 * This observer must remain read-only and must not expose state contents.
 */
export function hasObservedStorePendingWrite(runtime: StoreRuntimeState): boolean {
  return (
    runtime.writeTimer !== null ||
    runtime.firstPendingSaveAt !== null ||
    runtime.pendingWrite !== null ||
    runtime.pendingSnapshotFileWork !== null ||
    runtime.pendingProfileFlushes.size > 0 ||
    runtime.pendingProfileMaintenance !== null ||
    runtime.profileMaintenancePending ||
    runtime.quitFlushPromise !== null ||
    runtime.pendingGithubCacheWrite !== null ||
    runtime.githubCacheDirty ||
    runtime.profileStateAuthority?.hasPendingBackup?.() === true ||
    runtime.pendingAutomationRunsAfter !== undefined ||
    (runtime.dirtyProfileStateDomains !== null && runtime.dirtyProfileStateDomains.size > 0) ||
    (runtime.writeGeneration > 0 && runtime.writeGeneration > runtime.lastDurableWriteGeneration) ||
    runtime.activeViewPreference.hasPendingPersistenceWork()
  )
}
