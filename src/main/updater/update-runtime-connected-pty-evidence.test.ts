import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session/agent-session-host-authority'
import type { UpdateCensusDaemonAdapter, UpdateCensusProvider } from './update-runtime-census'
import { observeConnectedPtyPositiveEvidence } from './update-runtime-connected-pty-evidence'

const IDENTITY = { pid: 1860, startedAtMs: 1_800_000_000_000, launchNonce: 'authenticated-A' }
const OTHER_IDENTITY = { ...IDENTITY, pid: 1861, launchNonce: 'authenticated-B' }

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

function adapter(
  ids: readonly string[],
  options: {
    identity?: typeof IDENTITY
    disconnected?: boolean
    changed?: boolean
    unreadable?: boolean
    includeOwner?: boolean
  } = {}
): { adapter: UpdateCensusDaemonAdapter; read: ReturnType<typeof vi.fn> } {
  const identity = options.identity ?? IDENTITY
  const read = vi.fn(async () => {
    if (options.changed) replaced = true
    if (options.unreadable)
      return { state: 'unknown' as const, reason: 'inventory-unavailable' as const }
    return {
      state: 'complete' as const,
      identity,
      agentOwnershipComplete: true,
      sessions: ids.map((sessionId) => ({
        sessionId,
        state: 'running' as const,
        shellState: 'ready' as const,
        isAlive: true as const,
        pid: 987,
        cwd: null,
        cols: 80,
        rows: 24,
        createdAt: 1,
        agentSessionOwners: options.includeOwner ? [OWNER] : []
      }))
    }
  })
  let replaced = false
  return {
    read,
    adapter: {
      getDaemonIdentity: () =>
        options.disconnected
          ? null
          : replaced
            ? { ...identity, launchNonce: 'replaced' }
            : identity,
      getLastAuthenticatedDaemonIdentity: () =>
        options.disconnected
          ? null
          : replaced
            ? { ...identity, launchNonce: 'replaced' }
            : identity,
      listSessionsIfAlreadyConnected: read
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

describe('read-only authenticated connected-daemon writer evidence', () => {
  it('deduplicates PTYs and ownership digests across daemon generations and fallback', async () => {
    const a = adapter(['pty-a', 'pty-b'], { includeOwner: true })
    const b = adapter(['pty-b', 'pty-c'], { identity: OTHER_IDENTITY, includeOwner: true })
    const result = await observeConnectedPtyPositiveEvidence(() =>
      provider([a.adapter, b.adapter], async () => ['pty-c', 'pty-fallback'])
    )
    expect(result).toEqual({ ptySessions: 4, ptyOwnedAgentSessions: 1 })
    expect(a.read).toHaveBeenCalledOnce()
    expect(b.read).toHaveBeenCalledOnce()
  })

  it('does not connect or enumerate a disconnected daemon and does not treat its empty reply as proof', async () => {
    const missing = adapter(['phantom'], { disconnected: true })
    expect(await observeConnectedPtyPositiveEvidence(() => provider([missing.adapter]))).toEqual({
      ptySessions: 0,
      ptyOwnedAgentSessions: 0
    })
    expect(missing.read).not.toHaveBeenCalled()
  })

  it('rejects a changed authenticated daemon incarnation without dropping an independent positive', async () => {
    const changed = adapter(['old-pty'], { changed: true })
    const valid = adapter(['live-pty'], { identity: OTHER_IDENTITY })
    expect(
      await observeConnectedPtyPositiveEvidence(() => provider([changed.adapter, valid.adapter]))
    ).toEqual({ ptySessions: 1, ptyOwnedAgentSessions: 0 })
  })

  it('retains valid positives when another generation is unresponsive or malformed', async () => {
    const malformed = adapter(['unreadable'], { unreadable: true })
    const healthy = adapter(['live-pty'], { identity: OTHER_IDENTITY })
    expect(
      await observeConnectedPtyPositiveEvidence(() =>
        provider([malformed.adapter, healthy.adapter])
      )
    ).toEqual({ ptySessions: 1, ptyOwnedAgentSessions: 0 })
  })

  it('bounds an indefinitely pending daemon read and still returns fallback positive evidence', async () => {
    const stuck = adapter([])
    stuck.adapter.listSessionsIfAlreadyConnected = () => new Promise(() => {})
    const result = await observeConnectedPtyPositiveEvidence(() =>
      provider([stuck.adapter], async () => ['fallback-live'])
    )
    expect(result).toEqual({ ptySessions: 1, ptyOwnedAgentSessions: 0 })
  }, 3_000)

  it('does not invent positive evidence on missing providers, thrown getter, or excessive generations', async () => {
    expect(await observeConnectedPtyPositiveEvidence(() => null)).toEqual({
      ptySessions: 0,
      ptyOwnedAgentSessions: 0
    })
    expect(
      await observeConnectedPtyPositiveEvidence(() => {
        throw new Error('no provider')
      })
    ).toEqual({
      ptySessions: 0,
      ptyOwnedAgentSessions: 0
    })
    expect(
      await observeConnectedPtyPositiveEvidence(() =>
        provider(Array.from({ length: 17 }, () => adapter(['excess']).adapter))
      )
    ).toEqual({ ptySessions: 0, ptyOwnedAgentSessions: 0 })
  })
})
