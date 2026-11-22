import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session/agent-session-host-authority'
import type { SessionInfo } from '../daemon/protocol/daemon-session-info'
import { openProfileStateDatabase } from '../persistence/profile-state/profile-state-database'
import type { UpdateCensusDaemonAdapter, UpdateCensusProvider } from './update-runtime-census'
import { NO_STAGED_UPDATE_CANDIDATE, assessUpdatePreflight } from './update-preflight'
import { collectUpdateRuntimeCensus } from './update-runtime-census'

const IDENTITY = { pid: 123, startedAtMs: 456, launchNonce: 'daemon-incarnation' }
const SECOND_IDENTITY = { pid: 124, startedAtMs: 457, launchNonce: 'second-daemon-incarnation' }

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
    identity?: typeof IDENTITY
  } = {}
): UpdateCensusDaemonAdapter {
  let replaced = false
  const identity = options.identity ?? IDENTITY
  const currentIdentity = () =>
    replaced ? { ...identity, launchNonce: 'replacement-incarnation' } : identity
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
            identity,
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
  it('re-reads an authenticated quiet daemon before reporting zero PTYs', async () => {
    const quiet = adapter([])
    const original = quiet.listSessionsIfAlreadyConnected.bind(quiet)
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = () => {
      reads += 1
      return original()
    }
    const census = await read(provider([quiet]))
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({ state: 'known', count: 0 })
    expect(census.ptyOwnedAgentSessions).toEqual({ state: 'known', count: 0 })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
      decision: 'defer',
      activationAvailable: false
    })
  })

  it('reports busy when a PTY-owned agent appears between two authenticated inventories', async () => {
    const quiet = adapter([])
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = async () => ({
      state: 'complete' as const,
      identity: IDENTITY,
      sessions: reads++ === 0 ? [] : [session('late-agent-pty', [OWNER])],
      agentOwnershipComplete: true
    })
    const census = await read(provider([quiet]))
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining(['pty-inventory-unknown', 'pty-active', 'agent-session-active'])
    )
    expect(report.activationAvailable).toBe(false)
  })

  it('detects late degraded fallback PTYs rather than reusing an earlier empty fallback', async () => {
    let fallbackReads = 0
    const census = await read(
      provider([adapter([])], async () =>
        fallbackReads++ === 0 ? [] : ['late-local-fallback-pty']
      )
    )
    expect(fallbackReads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
  })

  it('fails closed when a second quiet snapshot disconnects or fails', async () => {
    const quiet = adapter([])
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = async () => {
      if (reads++ === 0) {
        return { state: 'complete', identity: IDENTITY, sessions: [], agentOwnershipComplete: true }
      }
      return { state: 'unknown', reason: 'daemon-disconnected' }
    }
    const census = await read(provider([quiet]))
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-disconnected',
      lowerBound: 0
    })
    expect(census.ptyOwnedAgentSessions.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
      decision: 'defer',
      activationAvailable: false
    })
  })

  it('treats a malformed quiet replay as an invalid inventory, never known zero', async () => {
    const quiet = adapter([])
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = async () =>
      reads++ === 0
        ? {
            state: 'complete' as const,
            identity: IDENTITY,
            sessions: [],
            agentOwnershipComplete: true
          }
        : {
            state: 'complete' as const,
            identity: IDENTITY,
            sessions: [{ sessionId: 'bad' }] as never,
            agentOwnershipComplete: true
          }
    const census = await read(provider([quiet]))
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-invalid',
      lowerBound: 0
    })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)).toMatchObject({
      decision: 'defer',
      activationAvailable: false
    })
  })

  it('rejects a replacement daemon incarnation during the quiet replay', async () => {
    const quiet = adapter([])
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = async () => ({
      state: 'complete' as const,
      identity: reads++ === 0 ? IDENTITY : SECOND_IDENTITY,
      sessions: [],
      agentOwnershipComplete: true
    })
    const census = await read(provider([quiet]))
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed',
      lowerBound: 0
    })
    expect(census.daemonGenerations.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('defer')
  })

  it('keeps late PTY and agent lower bounds from an authenticated replacement incarnation', async () => {
    const quiet = adapter([])
    let current = IDENTITY
    quiet.getDaemonIdentity = () => current
    quiet.getLastAuthenticatedDaemonIdentity = () => current
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = async () => {
      if (++reads === 1) {
        return {
          state: 'complete' as const,
          identity: IDENTITY,
          sessions: [],
          agentOwnershipComplete: true
        }
      }
      current = SECOND_IDENTITY
      return {
        state: 'complete' as const,
        identity: SECOND_IDENTITY,
        sessions: [session('authenticated-replacement-agent-pty', [OWNER])],
        agentOwnershipComplete: true
      }
    }
    const census = await read(provider([quiet]))
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining(['pty-inventory-unknown', 'pty-active', 'agent-session-active'])
    )
    expect(report.activationAvailable).toBe(false)
  })

  it('does not treat a quiet replay timeout as an authoritative zero count', async () => {
    const quiet = adapter([])
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = () =>
      reads++ === 0
        ? Promise.resolve({
            state: 'complete' as const,
            identity: IDENTITY,
            sessions: [],
            agentOwnershipComplete: true
          })
        : new Promise(() => {})
    const census = await read(provider([quiet]))
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 0
    })
    expect(census.ptyOwnedAgentSessions.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('defer')
  }, 3_000)

  it('rejects degraded fallback inventory that fails only during quiet confirmation', async () => {
    let reads = 0
    const census = await read(
      provider([adapter([])], () =>
        reads++ === 0 ? Promise.resolve([]) : Promise.reject(new Error('fallback lost'))
      )
    )
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'fallback-inventory-unavailable',
      lowerBound: 0
    })
    expect(census.ptyOwnedAgentSessions.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('defer')
  })

  it('rejects a daemon identity change while the second fallback scan runs', async () => {
    const quiet = adapter([])
    let replaced = false
    const currentIdentity = () =>
      replaced ? { ...IDENTITY, launchNonce: 'changed-after-recheck' } : IDENTITY
    quiet.getDaemonIdentity = currentIdentity
    quiet.getLastAuthenticatedDaemonIdentity = currentIdentity
    let fallbackReads = 0
    const census = await read(
      provider([quiet], async () => {
        if (++fallbackReads === 2) {
          replaced = true
        }
        return []
      })
    )
    expect(fallbackReads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed',
      lowerBound: 0
    })
    expect(census.ptyOwnedAgentSessions.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('defer')
  })

  it('does not retain a known-zero PTY inventory after its provider is replaced during replay', async () => {
    const quiet = adapter([])
    const first = provider([quiet])
    const second = provider([adapter([], { identity: SECOND_IDENTITY })])
    let selected = first
    let reads = 0
    const original = quiet.listSessionsIfAlreadyConnected.bind(quiet)
    quiet.listSessionsIfAlreadyConnected = async () => {
      const reply = await original()
      if (++reads === 2) {
        selected = second
      }
      return reply
    }
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => selected,
      now: () => 1_800_000_000_000
    })
    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'provider-changed',
      lowerBound: 0
    })
    expect(census.hostOwnership.state).toBe('unknown')
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('defer')
  })

  it('does not perform unnecessary replay RPCs after a busy authenticated inventory', async () => {
    const busy = adapter([session('already-active-pty', [OWNER])])
    const original = busy.listSessionsIfAlreadyConnected.bind(busy)
    let reads = 0
    busy.listSessionsIfAlreadyConnected = () => {
      reads += 1
      return original()
    }
    const census = await read(provider([busy]))
    expect(reads).toBe(1)
    expect(census.ptys).toEqual({ state: 'known', count: 1 })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
  })

  it('skips extra quiet PTY reads when an Ash window is already open', async () => {
    const quiet = adapter([])
    const original = quiet.listSessionsIfAlreadyConnected.bind(quiet)
    let reads = 0
    quiet.listSessionsIfAlreadyConnected = () => {
      reads += 1
      return original()
    }
    const census = await read(provider([quiet]), () => 1)
    expect(reads).toBe(1)
    expect(census.windows).toEqual({ state: 'known', count: 1 })
    expect(census.ptys).toEqual({ state: 'known', count: 0 })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
  })

  it('does not replay daemon RPCs if window inventory is unknown or becomes busy', async () => {
    for (const sample of [
      () => Number.NaN,
      (() => {
        let reads = 0
        return () => (reads++ === 0 ? 0 : 1)
      })()
    ]) {
      const quiet = adapter([])
      const original = quiet.listSessionsIfAlreadyConnected.bind(quiet)
      let daemonReads = 0
      quiet.listSessionsIfAlreadyConnected = () => {
        daemonReads += 1
        return original()
      }
      const census = await read(provider([quiet]), sample)
      expect(daemonReads).toBe(1)
      expect(census.windows.state).toBe('unknown')
      expect(census.ptys).toEqual({ state: 'known', count: 0 })
      expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).activationAvailable).toBe(
        false
      )
    }
  })

  it('accepts a finite fractional authenticated daemon start timestamp', async () => {
    // The real daemon derives its start time from Date.now() minus process.uptime(),
    // so a genuine incarnation commonly has fractional milliseconds.
    const fractionalIdentity = { ...IDENTITY, startedAtMs: 456.125 }
    const census = await read(
      provider([adapter([session('pty_fractional', [OWNER])], { identity: fractionalIdentity })]),
      () => 0
    )
    expect(census.ptys).toEqual({ state: 'known', count: 1 })
    expect(census.ptyOwnedAgentSessions).toEqual({ state: 'known', count: 1 })
    expect(assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census).decision).toBe('busy')
  })

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

    expect(unreachable.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-disconnected',
      lowerBound: 0
    })
    expect(partial.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 0
    })
    expect(replaced.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed',
      lowerBound: 0
    })
    expect(duplicate.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-invalid',
      lowerBound: 0
    })
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
      reason: 'agent-owner-inventory-incomplete',
      lowerBound: 0
    })
  })

  it('keeps valid fallback PTYs busy when a sibling entry is malformed', async () => {
    const census = await read(
      provider([adapter([])], async () => ['fallback-valid', 17] as unknown as readonly string[])
    )
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-invalid',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(expect.arrayContaining(['pty-inventory-unknown', 'pty-active']))
    expect(report.activationAvailable).toBe(false)
  })

  it('keeps a valid fallback PTY busy when the provider changes during the read', async () => {
    const first = provider([adapter([])], async () => ['fallback-observed'])
    const second = provider([adapter([], { identity: SECOND_IDENTITY })])
    let calls = 0
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => (calls++ === 0 ? first : second),
      now: () => 1_800_000_000_000
    })
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'provider-changed',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.activationAvailable).toBe(false)
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

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'provider-changed',
      lowerBound: 0
    })
    expect(census.hostOwnership.state).toBe('unknown')
  })

  it('keeps a stable authenticated PTY busy when the provider is replaced during the read', async () => {
    const first = provider([adapter([session('pty_stable', [OWNER])])])
    const second = provider([adapter([], { identity: SECOND_IDENTITY })])
    let calls = 0
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => (calls++ === 0 ? first : second),
      now: () => 1_800_000_000_000
    })
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'provider-changed',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'provider-changed',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining(['pty-inventory-unknown', 'pty-active', 'agent-session-active'])
    )
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
      reason: 'window-inventory-unavailable',
      lowerBound: 1
    })
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining(['window-inventory-unknown', 'gui-window-active'])
    )
    expect(report.activationAvailable).toBe(false)
  })

  it('preserves a seen window as busy even if it closes before the final census observation', async () => {
    let calls = 0
    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => (calls++ === 0 ? 1 : 0),
      getProvider: () => provider([adapter([])]),
      now: () => 1_800_000_000_000
    })
    expect(census.windows).toEqual({
      state: 'unknown',
      reason: 'window-inventory-unavailable',
      lowerBound: 1
    })
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)
    expect(report.decision).toBe('busy')
    expect(report.blockers).toContain('gui-window-active')
  })

  it('bounds an adapter inventory call even if its promise never resolves', async () => {
    const stuck = adapter([])
    stuck.listSessionsIfAlreadyConnected = () => new Promise(() => {})
    const census = await read(provider([stuck]))

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 0
    })
    expect(census.daemonGenerations).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 0
    })
  }, 3_000)

  it('bounds a hung local fallback inventory and never reports it as empty', async () => {
    const census = await read(
      provider([adapter([])], () => new Promise<readonly string[]>(() => {}))
    )

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'fallback-inventory-unavailable',
      lowerBound: 0
    })
  }, 3_000)

  it('preserves a stable authenticated PTY and agent as lower bounds when another daemon is unavailable', async () => {
    const census = await read(
      provider([
        adapter([session('pty_authenticated', [OWNER])]),
        adapter([], { identity: SECOND_IDENTITY, inventoryState: 'unknown' })
      ])
    )
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(census.windows).toEqual({ state: 'known', count: 0 })
    expect(census.daemonGenerations).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining(['pty-inventory-unknown', 'pty-active', 'agent-session-active'])
    )
    expect(report.activationAvailable).toBe(false)
  })

  it('preserves an authenticated PTY lower bound when degraded fallback inventory times out', async () => {
    const census = await read(
      provider(
        [adapter([session('pty_authenticated', [OWNER])])],
        () => new Promise<readonly string[]>(() => {})
      )
    )
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'fallback-inventory-unavailable',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'fallback-inventory-unavailable',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
  }, 3_000)

  it('preserves an authenticated active PTY when another adapter has no authenticated identity', async () => {
    const census = await read(
      provider([
        adapter([session('pty_authenticated', [OWNER])]),
        adapter([], { authenticated: false, identity: SECOND_IDENTITY })
      ])
    )
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'daemon-disconnected',
      lowerBound: 1
    })
    expect(census.ptyOwnedAgentSessions).toEqual({
      state: 'unknown',
      reason: 'daemon-disconnected',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.activationAvailable).toBe(false)
  })

  it('keeps pending disk writes unknown during a real profile database write transaction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-update-census-profile-write-'))
    const profileDirectory = join(root, 'profiles', 'fixture-profile')
    mkdirSync(profileDirectory, { recursive: true })
    const profile = openProfileStateDatabase(
      join(profileDirectory, 'profile-state.db'),
      'fixture-profile'
    )
    try {
      profile.db
        .prepare('INSERT INTO profile_state_meta (key, value) VALUES (?, ?)')
        .run('pending-write-fixture', 'before')
      profile.db.exec('BEGIN IMMEDIATE')
      profile.db
        .prepare('UPDATE profile_state_meta SET value = ? WHERE key = ?')
        .run('after', 'pending-write-fixture')

      const census = await read(provider([adapter([])]))

      expect(census.ptys).toEqual({ state: 'known', count: 0 })
      expect(census.pendingDiskWrites).toEqual({
        state: 'unknown',
        reason: 'pending-write-census-unavailable',
        lowerBound: 0
      })
    } finally {
      if (profile.db.isTransaction) {
        profile.db.exec('ROLLBACK')
      }
      profile.db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
