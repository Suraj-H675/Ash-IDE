import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateCensusDaemonAdapter } from './update-runtime-census'
import { NO_STAGED_UPDATE_CANDIDATE, assessUpdatePreflight } from './update-preflight'
import { collectAshUpdateRuntimeCensus } from './update-runtime-ash-census'

const fixture = vi.hoisted(() => ({
  loadedIds: ['native-1', 'native-2', 'resting-3'],
  executingIds: ['native-1', 'native-2'],
  missingHost: false,
  failRead: false,
  remoteObserved: 0,
  remoteWrite: false,
  remotePtys: 0,
  remotePtyOwners: 0,
  remoteBrowser: false,
  remoteFails: false,
  desktopDaemon: null as { adapters: UpdateCensusDaemonAdapter[] } | null
}))

vi.mock('../daemon/providers/lifecycle/daemon-provider-state', () => ({
  getDaemonProvider: () => fixture.desktopDaemon
}))
vi.mock('../daemon/providers/lifecycle/daemon-provider-routing', () => ({
  getAllDaemonAdapters: () => fixture.desktopDaemon?.adapters ?? []
}))
vi.mock('../daemon/providers/routing/degraded-daemon-pty-provider', () => ({
  DegradedDaemonPtyProvider: class {}
}))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () =>
    fixture.missingHost
      ? null
      : {
          loadedSessionIds: () => fixture.loadedIds,
          readStatusSummary: (id: string) => {
            if (fixture.failRead) {
              throw new Error('native Chat registry not readable')
            }
            return { hostExecutionOwned: fixture.executingIds.includes(id) }
          }
        }
}))
vi.mock('./update-runtime-provider-socket-observation', () => ({
  observeLocalRuntimeWriterActivity: async () => {
    if (fixture.remoteFails) {
      throw new Error('remote probe failed')
    }
    return {
      providerChildren: fixture.remoteObserved,
      pendingWrites: fixture.remoteWrite ? 1 : 0,
      ptySessions: fixture.remotePtys,
      ptyOwnedAgentSessions: fixture.remotePtyOwners,
      browserBackend: fixture.remoteBrowser ? 1 : 0
    }
  }
}))

afterEach(() => {
  fixture.loadedIds = ['native-1', 'native-2', 'resting-3']
  fixture.executingIds = ['native-1', 'native-2']
  fixture.missingHost = false
  fixture.failRead = false
  fixture.remoteObserved = 0
  fixture.remoteWrite = false
  fixture.remotePtys = 0
  fixture.remotePtyOwners = 0
  fixture.remoteBrowser = false
  fixture.remoteFails = false
  fixture.desktopDaemon = null
})

describe('RT-15 desktop native Chat provider evidence', () => {
  it('treats an available host-managed browser backend as a positive busy signal without claiming tabs or operations', async () => {
    fixture.executingIds = []
    fixture.remoteBrowser = true
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false,
      '/private-fixture'
    )
    expect(census.browserBackends).toEqual({
      state: 'unknown',
      reason: 'browser-backend-inventory-unavailable',
      lowerBound: 1
    })
    const preflight = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(preflight.decision).toBe('busy')
    expect(preflight.blockers).toEqual(
      expect.arrayContaining(['browser-backend-inventory-unknown', 'browser-backend-observed'])
    )
    expect(preflight.activationAvailable).toBe(false)
  })

  it('never treats missing or refused browser runtime evidence as complete no-browser proof', async () => {
    fixture.executingIds = []
    for (const scenario of ['older-response', 'refused-socket'] as const) {
      fixture.remoteFails = scenario === 'refused-socket'
      const census = await collectAshUpdateRuntimeCensus(
        () => 0,
        () => false,
        '/private-fixture'
      )
      expect(census.browserBackends).toEqual({
        state: 'unknown',
        reason: 'browser-backend-inventory-unavailable',
        lowerBound: 0
      })
      expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
        decision: 'defer',
        activationAvailable: false
      })
    }
  })

  it.each(['older-runtime', 'unreachable-runtime'] as const)(
    'never promotes an authenticated desktop zero to complete cross-process zero with %s',
    async (scenario) => {
      fixture.executingIds = []
      const identity = { pid: 123, startedAtMs: 1_800_000_000_000, launchNonce: 'desktop-daemon' }
      fixture.desktopDaemon = {
        adapters: [
          {
            getDaemonIdentity: () => identity,
            getLastAuthenticatedDaemonIdentity: () => identity,
            listSessionsIfAlreadyConnected: async () => ({
              state: 'complete' as const,
              identity,
              sessions: [],
              agentOwnershipComplete: true
            })
          }
        ]
      }
      fixture.remoteFails = scenario === 'unreachable-runtime'
      const census = await collectAshUpdateRuntimeCensus(
        () => 0,
        () => false,
        '/private-fixture'
      )
      expect(census.ptys).toEqual({
        state: 'unknown',
        reason: 'inventory-partial',
        lowerBound: 0
      })
      expect(census.ptyOwnedAgentSessions).toEqual({
        state: 'unknown',
        reason: 'agent-owner-inventory-incomplete',
        lowerBound: 0
      })
      expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
        decision: 'defer',
        activationAvailable: false
      })
    }
  )

  it('does not retain an old known-zero desktop PTY census after a separate runtime reports a live PTY', async () => {
    fixture.executingIds = []
    const identity = { pid: 123, startedAtMs: 1_800_000_000_000, launchNonce: 'desktop-daemon' }
    fixture.desktopDaemon = {
      adapters: [
        {
          getDaemonIdentity: () => identity,
          getLastAuthenticatedDaemonIdentity: () => identity,
          listSessionsIfAlreadyConnected: async () => ({
            state: 'complete' as const,
            identity,
            sessions: [],
            agentOwnershipComplete: true
          })
        }
      ]
    }
    fixture.remotePtys = 1
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false,
      '/private-fixture'
    )
    expect(census.ptys).toEqual({ state: 'unknown', reason: 'inventory-partial', lowerBound: 1 })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
      decision: 'busy',
      activationAvailable: false
    })
  })

  it('merges positive authenticated daemon PTYs and owner claims without claiming a complete inventory', async () => {
    fixture.executingIds = []
    fixture.remotePtys = 2
    fixture.remotePtyOwners = 1
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false,
      '/private-fixture'
    )
    expect(census.ptys).toEqual({ state: 'unknown', reason: 'inventory-partial', lowerBound: 2 })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'agent-owner-inventory-incomplete',
      lowerBound: 1
    })
    const preflight = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(preflight.decision).toBe('busy')
    expect(preflight.blockers).toEqual(
      expect.arrayContaining(['pty-active', 'agent-session-active'])
    )
    expect(preflight.activationAvailable).toBe(false)
  })

  it('retains authenticated runtime pending Store writes when this desktop has no local write', async () => {
    fixture.executingIds = []
    fixture.remoteWrite = true
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false,
      '/private-fixture'
    )
    expect(census.pendingDiskWrites).toEqual({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 1
    })
    const preflight = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(preflight.decision).toBe('busy')
    expect(preflight.blockers).toContain('pending-disk-writes-observed')
    expect(preflight.activationAvailable).toBe(false)
  })

  it('uses the maximum of desktop and runtime Store activity, not a claimed complete count', async () => {
    fixture.remoteWrite = true
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => true,
      '/private-fixture'
    )
    expect(census.pendingDiskWrites.lowerBound).toBe(1)
    expect(census.pendingDiskWrites.state).toBe('unknown')
  })

  it('keeps older, missing and failed runtime writer observations unknown and update activation off', async () => {
    fixture.executingIds = []
    fixture.remoteFails = true
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false,
      '/private-fixture'
    )
    expect(census.pendingDiskWrites).toEqual({
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 0
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
      decision: 'defer',
      activationAvailable: false
    })
  })
  it('takes the stronger positive local or authenticated runtime count, not the sum', async () => {
    fixture.remoteObserved = 4
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false,
      '/private-fixture'
    )
    expect(census.providerAgentSessions).toEqual({
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable',
      lowerBound: 4
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
  })
  it('reports observed host-owned provider children as busy without relying on daemon availability', async () => {
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false
    )
    expect(census.windows).toEqual({ state: 'known', count: 0 })
    expect(census.ptys.state).toBe('unknown')
    expect(census.providerAgentSessions).toEqual({
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable',
      lowerBound: 2
    })
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'provider-agent-inventory-unknown',
        'provider-agent-session-observed'
      ])
    )
    expect(report.activationAvailable).toBe(false)
  })

  it('does not count a merely loaded resting conversation as an active provider child', async () => {
    fixture.executingIds = []
    const census = await collectAshUpdateRuntimeCensus(
      () => 0,
      () => false
    )
    expect(census.providerAgentSessions).toEqual({
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable'
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('defer')
  })

  it('keeps a missing or unreadable native Chat host unknown, never a verified zero', async () => {
    for (const mode of ['missing', 'throws'] as const) {
      fixture.missingHost = mode === 'missing'
      fixture.failRead = mode === 'throws'
      const census = await collectAshUpdateRuntimeCensus(
        () => 0,
        () => false
      )
      expect(census.providerAgentSessions).toEqual({
        state: 'unknown',
        reason: 'provider-agent-inventory-unavailable'
      })
      expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).activationAvailable).toBe(
        false
      )
    }
  })
})
