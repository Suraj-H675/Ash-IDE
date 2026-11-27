import { session, type Session } from 'electron'
import type { BrowserSessionProfile } from '../../../shared/browser-workspace-types'
import {
  fenceProxySessionApplication,
  retireProxySessionApplication
} from '../../network/proxy-settings'
import {
  clearBrowserSessionPartitionPolicies,
  retireDeletedBrowserSessionPartitionPolicies
} from './browser-session-partition-policies'
import { detachBrowserExtensionsFromProfileSession } from '../extensions/profile-sessions/browser-extension-session-loader'

export async function retireFailedBrowserSessionProfile(
  partition: string,
  sess: Session
): Promise<void> {
  const retirement = retireProxySessionApplication(sess)
  try {
    clearBrowserSessionPartitionPolicies(partition, sess)
  } catch {
    // Best-effort policy cleanup must not skip retirement.
  }
  try {
    await retirement
  } catch {
    console.warn('[proxy] Failed to release proxy from browser partition', partition)
  }
}

/** Profile delete, after the registry has dropped it: unload extensions and clear its storage. */
export async function retireDeletedBrowserSessionProfile(
  profile: BrowserSessionProfile,
  beforeRetirement?: () => Promise<void> | undefined
): Promise<void> {
  const sess = session.fromPartition(profile.partition)
  // Fence old permissions before waiting for any asynchronous retirement.
  const failures: unknown[] = []
  try {
    retireDeletedBrowserSessionPartitionPolicies(profile.partition, sess)
  } catch (error) {
    failures.push(error)
  }
  // Keep the current route pinned until native retirement and all revocations succeed.
  const fence = fenceProxySessionApplication(sess).catch((error: unknown) => {
    failures.push(error)
  })
  try {
    await beforeRetirement?.()
  } catch (error) {
    // The profile is already deleted and persisted, so route cleanup stays best-effort.
    console.warn('[browser-session] Failed to retire route partitions for deleted profile', error)
  }
  try {
    await detachBrowserExtensionsFromProfileSession(profile)
  } catch (error) {
    failures.push(error)
  } finally {
    await fence
  }
  if (failures.length === 1) {
    throw failures[0]
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Could not safely retire deleted browser profile')
  }
  // Preserve all partition storage if extension retirement could not confirm native absence.
  await retireProxySessionApplication(sess)
  try {
    await sess.clearStorageData()
    await sess.clearCache()
  } catch {
    // Cleanup is best-effort; the profile is already out of the registry.
  }
}
