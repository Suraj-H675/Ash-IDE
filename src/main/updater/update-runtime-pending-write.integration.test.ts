import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture } from '../persistence/loading-store/profile-state-delayed-authority-fixture'
import { ProfileStateBackupRotation } from '../persistence/profile-state/profile-state-backup-rotation'
import {
  ActiveViewPreference,
  getActiveViewPreferenceFile
} from '../persistence/preferences/active-view-preference'
import { NO_STAGED_UPDATE_CANDIDATE, assessUpdatePreflight } from './update-preflight'
import { collectUpdateRuntimeCensus } from './update-runtime-census'
import type { UpdateCensusProvider } from './update-runtime-census'

/** Real disposable SQLite-backed Store; no mocked write-generation counters. */
describe('RT-15 observed local profile writes', () => {
  it('marks an in-flight SQLite profile write busy with zero windows and no daemon', async () => {
    const { store, authority, readState } = await fixture()
    const read = async () =>
      assessUpdatePreflight(
        NO_STAGED_UPDATE_CANDIDATE,
        await collectUpdateRuntimeCensus({
          getWindowCount: () => 0,
          getProvider: () => null,
          getLocalPendingWriteActivity: () => store.hasObservedPendingLocalWrite()
        })
      )
    expect(store.hasObservedPendingLocalWrite()).toBe(false)
    expect((await read()).runtime.pendingDiskWrites).toMatchObject({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 0
    })
    expect((await read()).decision).toBe('defer')

    const next = !store.getSettings().agentStatusHooksEnabled
    const held = authority.pause()
    store.updateSettings({ agentStatusHooksEnabled: next })
    expect(store.hasObservedPendingLocalWrite()).toBe(true)
    const flushing = store.flushPendingOrThrowAsync()
    await held.started.promise
    try {
      const during = await read()
      expect(during.runtime.windows).toEqual({ state: 'known', count: 0 })
      expect(during.runtime.ptys.state).toBe('unknown')
      expect(during.runtime.pendingDiskWrites).toEqual({
        state: 'unknown',
        reason: 'pending-write-census-unavailable',
        lowerBound: 1
      })
      expect(during.decision).toBe('busy')
      expect(during.blockers).toEqual(
        expect.arrayContaining(['pending-disk-writes-unknown', 'pending-disk-writes-observed'])
      )
      expect(during.activationAvailable).toBe(false)
    } finally {
      held.finish.resolve()
    }
    await flushing
    expect(readState().settings.agentStatusHooksEnabled).toBe(next)
    expect(store.hasObservedPendingLocalWrite()).toBe(false)
    const after = await read()
    expect(after.runtime.pendingDiskWrites).toEqual({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 0
    })
    expect(after.decision).toBe('defer')
    expect(after.activationAvailable).toBe(false)
  })

  it('retains the initial positive observation when a later census is quiet', async () => {
    const { store } = await fixture()
    const before = store.hasObservedPendingLocalWrite()
    expect(before).toBe(false)
    let sample = true
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => null,
      getLocalPendingWriteActivity: () => {
        const observed = sample
        sample = false
        return observed
      }
    })
    expect(census.pendingDiskWrites).toEqual({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 1
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
  })

  it('notices a real Store save admitted during the authenticated daemon census', async () => {
    const { store, readState } = await fixture()
    expect(store.hasObservedPendingLocalWrite()).toBe(false)
    const next = !store.getSettings().agentStatusHooksEnabled
    const identity = { pid: 152, startedAtMs: 1_800_000_000_000, launchNonce: 'private-daemon' }
    let inventoryReads = 0
    const adapter = {
      getDaemonIdentity: () => identity,
      getLastAuthenticatedDaemonIdentity: () => identity,
      listSessionsIfAlreadyConnected: async () => {
        if (++inventoryReads === 1) {
          await Promise.resolve()
          store.updateSettings({ agentStatusHooksEnabled: next })
        }
        return {
          state: 'complete' as const,
          identity,
          sessions: [],
          agentOwnershipComplete: true
        }
      }
    }
    const provider: UpdateCensusProvider = { identity: {}, adapters: [adapter] }
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => provider,
      getLocalPendingWriteActivity: () => store.hasObservedPendingLocalWrite()
    })
    expect(inventoryReads).toBe(2)
    expect(census.ptys).toEqual({ state: 'known', count: 0 })
    expect(census.pendingDiskWrites).toEqual({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 1
    })
    const preflight = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(preflight.decision).toBe('busy')
    expect(preflight.activationAvailable).toBe(false)
    await store.flushPendingOrThrowAsync()
    expect(readState().settings.agentStatusHooksEnabled).toBe(next)
    expect(store.hasObservedPendingLocalWrite()).toBe(false)
  })

  it('keeps a failed local observation unknown and retains a previously observed write', async () => {
    let calls = 0
    const interrupted = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => null,
      getLocalPendingWriteActivity: () => {
        if (++calls === 1) {
          return true
        }
        throw new Error('inaccessible local write owner')
      }
    })
    expect(calls).toBe(2)
    expect(interrupted.pendingDiskWrites).toMatchObject({
      state: 'unknown',
      lowerBound: 1
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, interrupted).decision).toBe('busy')

    const unobservable = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => null,
      getLocalPendingWriteActivity: () => {
        throw new Error('inaccessible local write owner')
      }
    })
    expect(unobservable.pendingDiskWrites).toEqual({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 0
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, unobservable)).toMatchObject({
      decision: 'defer',
      activationAvailable: false
    })
  })

  it('keeps an active SQLite backup rotation busy after primary Store writes have drained', async () => {
    const { store, authority } = await fixture()
    expect(store.hasObservedPendingLocalWrite()).toBe(false)
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const rotation = new ProfileStateBackupRotation(
      join(store.getProfileStorageDirectory(), 'profile-state.db'),
      'coordination-test',
      Date.now,
      async () => {
        started.resolve()
        await release.promise
      }
    )
    // The disposable authority exposes the same optional observer as the
    // production worker and synchronous SQLite authorities.
    Object.assign(authority, { hasPendingBackup: () => rotation.hasPendingBackup() })
    try {
      rotation.schedule()
      expect(rotation.hasPendingBackup()).toBe(true)
      await started.promise
      expect(store.hasObservedPendingLocalWrite()).toBe(true)
      const census = await collectUpdateRuntimeCensus({
        getWindowCount: () => 0,
        getProvider: () => null,
        getLocalPendingWriteActivity: () => store.hasObservedPendingLocalWrite()
      })
      expect(census.pendingDiskWrites).toEqual({
        state: 'unknown',
        reason: 'pending-write-census-unavailable',
        lowerBound: 1
      })
      expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
    } finally {
      release.resolve()
      await rotation.drain()
    }
    expect(rotation.hasPendingBackup()).toBe(false)
    expect(store.hasObservedPendingLocalWrite()).toBe(false)
    const quiet = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => null,
      getLocalPendingWriteActivity: () => store.hasObservedPendingLocalWrite()
    })
    expect(quiet.pendingDiskWrites).toMatchObject({ state: 'unknown', lowerBound: 0 })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, quiet).decision).toBe('defer')
  })

  it('observes debounced active-view persistence without treating its startup default as dirty', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ash-rt15-active-view-'))
    const dataFile = join(directory, 'ash-state.json')
    try {
      const preference = new ActiveViewPreference(dataFile, 'terminal')
      expect(preference.hasPendingPersistenceWork()).toBe(false)
      expect(preference.set('settings')).toBe(true)
      expect(preference.hasPendingPersistenceWork()).toBe(true)
      await preference.flushPendingAsync()
      expect(preference.hasPendingPersistenceWork()).toBe(false)
      expect(JSON.parse(readFileSync(getActiveViewPreferenceFile(dataFile), 'utf8'))).toEqual({
        activeView: 'settings'
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
