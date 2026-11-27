import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_LOCAL_ORCA_PROFILE_ID,
  getOrcaProfileBrowserDefaultPartition,
  getOrcaProfileBrowserSessionPartition
} from '../../../shared/orca-profiles'
import type { BrowserSessionProfile } from '../../../shared/browser-workspace-types'
import {
  BrowserProfileDeletionCoordinator,
  pendingBrowserProfileDeletions
} from './browser-session-deletion-journal'
import { loadBrowserSessionMeta, persistBrowserSessionMeta } from './browser-session-meta-store'

const directories: string[] = []
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ash-profile-deletion-'))
  directories.push(directory)
  const activeProfileId = DEFAULT_LOCAL_ORCA_PROFILE_ID
  const journal = {
    metadataPath: join(directory, 'browser-session-meta.json'),
    activeProfileId,
    defaultPartition: getOrcaProfileBrowserDefaultPartition(activeProfileId)
  }
  const profile = (id: string): BrowserSessionProfile => ({
    id,
    partition: getOrcaProfileBrowserSessionPartition(activeProfileId, id),
    label: 'Fixture',
    scope: 'isolated',
    source: null
  })
  const a = profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  const b = profile('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  const active = new Map([
    [a.id, a],
    [b.id, b]
  ])
  const read = () =>
    loadBrowserSessionMeta(() => journal.metadataPath, journal.defaultPartition, true)
  const persist = (updates: Parameters<typeof persistBrowserSessionMeta>[2]) =>
    persistBrowserSessionMeta(() => journal.metadataPath, journal.defaultPartition, updates, true)
  persist({
    profiles: [a, b],
    enabledExtensionIdsByProfileId: { [a.id]: ['extension-a'], [b.id]: ['extension-b'] }
  })
  return { journal, a, b, active, read, persist }
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('browser profile deletion recovery journal', () => {
  it('persists removal and exact cleanup owner before retirement; retries after restart without affecting another profile', async () => {
    const { journal, a, b, active, read, persist } = fixture()
    const retire = vi.fn(async () => {
      expect(read().profiles).toEqual([b])
      expect(read().pendingProfileDeletions).toEqual([a])
      expect(active.has(a.id)).toBe(false)
      throw new Error('native removal refused')
    })
    const changed = vi.fn()
    const first = new BrowserProfileDeletionCoordinator(() => journal, active, changed, retire)
    await expect(first.delete(a.id)).rejects.toThrow('native removal refused')
    expect(changed).toHaveBeenCalledOnce()
    expect(read().enabledExtensionIdsByProfileId).toEqual({ [b.id]: ['extension-b'] })
    // Unrelated metadata writes during recovery must retain the record.
    persist({ pinnedExtensionIdsByProfileId: { [b.id]: ['extension-b'] } })
    const restarted = new Map(read().profiles.map((p) => [p.id, p]))
    const retry = vi.fn(async () => {})
    await new BrowserProfileDeletionCoordinator(() => journal, restarted, vi.fn(), retry).resume()
    expect(retry).toHaveBeenCalledExactlyOnceWith(a)
    expect(read().pendingProfileDeletions).toEqual([])
    expect(read().profiles).toEqual([b])
    expect(read().pinnedExtensionIdsByProfileId).toEqual({ [b.id]: ['extension-b'] })
  })

  it('does not revoke or retire a profile when metadata cannot be read or durably written', async () => {
    const { journal, a, active } = fixture()
    const changed = vi.fn()
    const retire = vi.fn(async () => {})
    const coordinator = new BrowserProfileDeletionCoordinator(
      () => journal,
      active,
      changed,
      retire
    )
    writeFileSync(journal.metadataPath, 'invalid json')
    await expect(coordinator.delete(a.id)).rejects.toThrow()
    expect(active.get(a.id)).toEqual(a)
    expect(retire).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(readFileSync(journal.metadataPath, 'utf8')).toBe('invalid json')
  })

  it('preserves a failed recovery and refuses foreign, default, duplicate and still-active partitions', async () => {
    const { journal, a, b, active, read, persist } = fixture()
    const foreign = { ...a, partition: 'persist:foreign' }
    const defaultProfile = {
      ...a,
      id: 'default',
      partition: journal.defaultPartition,
      scope: 'default' as const
    }
    persist({ pendingProfileDeletions: [a, foreign, defaultProfile, b, b] })
    expect(pendingBrowserProfileDeletions(journal)).toEqual([])
    const retire = vi.fn(async () => {
      throw new Error('still pending')
    })
    const coordinator = new BrowserProfileDeletionCoordinator(
      () => journal,
      active,
      vi.fn(),
      retire
    )
    await coordinator.resume()
    expect(retire).not.toHaveBeenCalled()
    expect(read().pendingProfileDeletions).toHaveLength(5)
    persist({ profiles: [b], pendingProfileDeletions: [a] })
    active.delete(a.id)
    await coordinator.resume()
    expect(retire).toHaveBeenCalledExactlyOnceWith(a)
    expect(read().pendingProfileDeletions).toEqual([a])
  })
})
