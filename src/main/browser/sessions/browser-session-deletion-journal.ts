import type { BrowserSessionProfile } from '../../../shared/browser-workspace-types'
import { isValidPersistedBrowserSessionProfile } from './browser-session-persisted-profile-validation'
import {
  forgetBrowserSessionProfileMeta,
  loadBrowserSessionMeta,
  persistBrowserSessionMeta
} from './browser-session-meta-store'

type Journal = {
  metadataPath: string
  defaultPartition: string
  activeProfileId: string
}

function ownsPartition(journal: Journal, profile: unknown): profile is BrowserSessionProfile {
  return (
    isValidPersistedBrowserSessionProfile(profile, journal.activeProfileId) &&
    (profile.scope === 'isolated' || profile.scope === 'imported') &&
    profile.partition !== journal.defaultPartition
  )
}

function read(journal: Journal) {
  return loadBrowserSessionMeta(() => journal.metadataPath, journal.defaultPartition, true)
}

function persist(journal: Journal, updates: Parameters<typeof persistBrowserSessionMeta>[2]): void {
  persistBrowserSessionMeta(() => journal.metadataPath, journal.defaultPartition, updates, true)
}

/** Atomically revoke persisted selection and record the exact cleanup owner before any deletion. */
export function recordBrowserProfileDeletion(
  journal: Journal,
  profile: BrowserSessionProfile,
  activeProfiles: BrowserSessionProfile[]
): void {
  if (!ownsPartition(journal, profile)) {
    throw new Error('Cannot retire an unowned browser partition')
  }
  const meta = read(journal)
  if (
    meta.pendingProfileDeletions.some(
      (entry) => entry?.id === profile.id || entry?.partition === profile.partition
    )
  ) {
    throw new Error('Browser profile retirement is already pending')
  }
  persist(journal, {
    ...forgetBrowserSessionProfileMeta(meta, profile, journal.defaultPartition),
    profiles: activeProfiles.filter((entry) => entry.id !== 'default' && entry.id !== profile.id),
    pendingProfileDeletions: [...meta.pendingProfileDeletions, profile]
  })
}

/** Keep invalid, conflicting or duplicate records on disk; never clear a live or foreign partition. */
export function pendingBrowserProfileDeletions(journal: Journal): BrowserSessionProfile[] {
  const meta = read(journal)
  return meta.pendingProfileDeletions.filter(
    (profile) =>
      ownsPartition(journal, profile) &&
      !meta.profiles.some(
        (entry) => entry?.id === profile.id || entry?.partition === profile.partition
      ) &&
      meta.pendingProfileDeletions.filter(
        (entry) => entry?.id === profile.id || entry?.partition === profile.partition
      ).length === 1
  )
}

export async function finishBrowserProfileDeletion(
  journal: Journal,
  profile: BrowserSessionProfile,
  retire: () => Promise<void>
): Promise<void> {
  const pending = pendingBrowserProfileDeletions(journal)
  if (!pending.some((entry) => entry.id === profile.id && entry.partition === profile.partition)) {
    throw new Error('Browser profile retirement record is unavailable')
  }
  await retire()
  const meta = read(journal)
  persist(journal, {
    pendingProfileDeletions: meta.pendingProfileDeletions.filter(
      (entry) => entry?.id !== profile.id || entry?.partition !== profile.partition
    )
  })
}

/** Own deletion and restart recovery without admitting retired profiles back to the registry. */
export class BrowserProfileDeletionCoordinator {
  constructor(
    private readonly journal: () => Journal,
    private readonly active: Map<string, BrowserSessionProfile>,
    private readonly changed: () => void,
    private readonly retire: (profile: BrowserSessionProfile) => Promise<void>
  ) {}

  async delete(profileId: string): Promise<boolean> {
    const profile = this.active.get(profileId)
    if (!profile || profile.scope === 'default') {
      return false
    }
    const journal = this.journal()
    recordBrowserProfileDeletion(journal, profile, [...this.active.values()])
    this.active.delete(profileId)
    // Start fencing before notifying observers; the durable record already excludes this profile.
    const finish = finishBrowserProfileDeletion(journal, profile, () => this.retire(profile))
    try {
      this.changed()
    } finally {
      await finish
    }
    return true
  }

  async resume(): Promise<void> {
    const journal = this.journal()
    for (const profile of pendingBrowserProfileDeletions(journal)) {
      if (
        [...this.active.values()].some(
          (p) => p.id === profile.id || p.partition === profile.partition
        )
      ) {
        continue
      }
      try {
        await finishBrowserProfileDeletion(journal, profile, () => this.retire(profile))
      } catch (error) {
        console.warn('[browser-session] Pending profile cleanup failed:', error)
      }
    }
  }
}
