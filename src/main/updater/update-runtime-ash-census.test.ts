import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_STAGED_UPDATE_CANDIDATE, assessUpdatePreflight } from './update-preflight'
import { collectAshUpdateRuntimeCensus } from './update-runtime-ash-census'

const fixture = vi.hoisted(() => ({
  loadedIds: ['native-1', 'native-2', 'resting-3'],
  executingIds: ['native-1', 'native-2'],
  missingHost: false,
  failRead: false,
  remoteObserved: 0,
  remoteFails: false
}))

vi.mock('../daemon/providers/lifecycle/daemon-provider-state', () => ({
  getDaemonProvider: () => null
}))
vi.mock('../daemon/providers/lifecycle/daemon-provider-routing', () => ({
  getAllDaemonAdapters: () => []
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
  observeLocalRuntimeProviderChildren: async () => {
    if (fixture.remoteFails) throw new Error('remote probe failed')
    return fixture.remoteObserved
  }
}))

afterEach(() => {
  fixture.loadedIds = ['native-1', 'native-2', 'resting-3']
  fixture.executingIds = ['native-1', 'native-2']
  fixture.missingHost = false
  fixture.failRead = false
  fixture.remoteObserved = 0
  fixture.remoteFails = false
})

describe('RT-15 desktop native Chat provider evidence', () => {
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
