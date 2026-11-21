import { describe, expect, it } from 'vitest'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session/agent-session-host-authority'
import type { SessionInfo } from '../daemon/protocol/daemon-session-info'
import type { UpdateCensusDaemonAdapter, UpdateCensusProvider } from './update-runtime-census'
import { collectUpdateRuntimeCensus } from './update-runtime-census'

const IDENTITY = { pid: 123, startedAtMs: 456, launchNonce: 'daemon-incarnation' }

const OWNER: AgentSessionOwnerBinding = {
  claim: {
    digestVersion: 1,
    keyId: 'fixture-key',
    identityDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    worktreeScopeDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    agent: 'codex'
  },
  generation: 'fixture-generation',
  phase: 'live',
  ptyId: 'fixture-pty',
  surface: {
    worktreeId: 'fixture-worktree',
    tabId: '11111111-1111-4111-8111-111111111111',
    leafId: '11111111-1111-4111-8111-111111111112',
    terminalHandle: 'term_abcdefgh'
  }
}

function session(
  sessionId: string,
  agentSessionOwners: AgentSessionOwnerBinding[] = []
): SessionInfo {
  return {
    sessionId,
    state: 'running',
    shellState: 'ready',
    isAlive: true,
    pid: 987,
    cwd: null,
    cols: 80,
    rows: 24,
    createdAt: 1,
    agentSessionOwners
  }
}

function adapter(
  sessions: SessionInfo[],
  options: {
    authenticated?: boolean
    changeIdentityDuringListing?: boolean
    inventoryState?: 'complete' | 'unknown'
  } = {}
): UpdateCensusDaemonAdapter {
  let replaced = false
  const currentIdentity = () =>
    replaced ? { ...IDENTITY, launchNonce: 'replacement-incarnation' } : IDENTITY
  return {
    getDaemonIdentity: () => (options.authenticated === false ? null : currentIdentity()),
    getLastAuthenticatedDaemonIdentity: () =>
      options.authenticated === false ? null : currentIdentity(),
    listSessionsIfAlreadyConnected: async () => {
      if (options.changeIdentityDuringListing) {
        replaced = true
      }
      return options.inventoryState === 'unknown'
        ? { state: 'unknown', reason: 'inventory-unavailable' }
        : {
            state: 'complete',
            identity: IDENTITY,
            sessions,
            agentOwnershipComplete: true
          }
    }
  }
}

function provider(
  adapters: readonly UpdateCensusDaemonAdapter[],
  fallback?: () => Promise<readonly string[]>
): UpdateCensusProvider {
  return {
    identity: {},
    adapters,
    ...(fallback ? { listFallbackPtyIds: fallback } : {})
  }
}

function read(currentProvider: UpdateCensusProvider | null, getWindowCount = () => 0) {
  return collectUpdateRuntimeCensus({
    getWindowCount,
    getProvider: () => currentProvider,
    now: () => 1_800_000_000_000
  })
}

describe('Ash update runtime census', () => {
  it('counts authenticated daemon generations, windows, PTYs, and PTY-owned agents', async () => {
    const census = await read(provider([adapter([session('pty_fixture', [OWNER])])]), () => 2)

    expect(census).toMatchObject({
      hostOwnership: { state: 'unknown', reason: 'exclusive-host-ownership-unavailable' },
      daemonGenerations: { state: 'known', count: 1 },
      windows: { state: 'known', count: 2 },
      ptys: { state: 'known', count: 1 },
      ptyOwnedAgentSessions: { state: 'known', count: 1 },
      providerAgentSessions: { state: 'unknown' },
      pendingDiskWrites: { state: 'unknown' }
    })
  })

  it('keeps unreachable, partial, malformed, and replaced inventories unknown', async () => {
    const unreachable = await read(provider([adapter([], { authenticated: false })]))
    const partial = await read(provider([adapter([], { inventoryState: 'unknown' })]))
    const replaced = await read(provider([adapter([], { changeIdentityDuringListing: true })]))
    const duplicate = await read(
      provider([adapter([session('pty_duplicate'), session('pty_duplicate')])])
    )

    expect(unreachable.ptys).toEqual({ state: 'unknown', reason: 'daemon-disconnected' })
    expect(partial.ptys).toEqual({ state: 'unknown', reason: 'inventory-partial' })
    expect(replaced.ptys).toEqual({ state: 'unknown', reason: 'daemon-identity-changed' })
    expect(duplicate.ptys).toEqual({ state: 'unknown', reason: 'inventory-invalid' })
    expect(
      [unreachable, partial, replaced, duplicate].every(
        (entry) => entry.hostOwnership.state === 'unknown'
      )
    ).toBe(true)
  })

  it('counts degraded fallback PTYs but keeps agent ownership incomplete', async () => {
    const census = await read(provider([adapter([])], async () => ['fallback-one', 'fallback-two']))

    expect(census.ptys).toEqual({ state: 'known', count: 2 })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'agent-owner-inventory-incomplete'
    })
  })

  it('defers when the runtime provider changes during the read', async () => {
    const first = provider([adapter([])])
    const second = provider([adapter([])])
    let calls = 0
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => (calls++ === 0 ? first : second),
      now: () => 1_800_000_000_000
    })

    expect(census.ptys).toEqual({ state: 'unknown', reason: 'provider-changed' })
    expect(census.hostOwnership.state).toBe('unknown')
  })

  it('marks window evidence unknown when the window inventory changes during the read', async () => {
    let calls = 0
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => (calls++ === 0 ? 0 : 1),
      getProvider: () => provider([adapter([])]),
      now: () => 1_800_000_000_000
    })

    expect(census.windows).toEqual({
      state: 'unknown',
      reason: 'window-inventory-unavailable'
    })
  })

  it('bounds an adapter inventory call even if its promise never resolves', async () => {
    const stuck = adapter([])
    stuck.listSessionsIfAlreadyConnected = () => new Promise(() => {})
    const census = await read(provider([stuck]))

    expect(census.ptys).toEqual({ state: 'unknown', reason: 'inventory-partial' })
    expect(census.daemonGenerations).toEqual({ state: 'unknown', reason: 'inventory-partial' })
  }, 3_000)

  it('bounds a hung local fallback inventory and never reports it as empty', async () => {
    const census = await read(
      provider([adapter([])], () => new Promise<readonly string[]>(() => {}))
    )

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'fallback-inventory-unavailable'
    })
  }, 3_000)
})
