import '../../../pty-subprocess/testing/mock-descendant-sweep'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonClient } from '../../../transport/client/daemon-client'
import {
  NO_STAGED_UPDATE_CANDIDATE,
  assessUpdatePreflight
} from '../../../../updater/update-preflight'
import { collectUpdateRuntimeCensus } from '../../../../updater/update-runtime-census'
import {
  createMockSubprocess,
  startDaemonAdapterHarness,
  type DaemonAdapterHarness
} from './daemon-pty-adapter-test-harness'

describe('connected-only daemon session census', () => {
  let harness: DaemonAdapterHarness | undefined

  const getHarness = (): DaemonAdapterHarness => {
    if (!harness) {
      throw new Error('daemon adapter test harness was not started')
    }
    return harness
  }

  beforeEach(async () => {
    harness = await startDaemonAdapterHarness(() => createMockSubprocess())
  })

  afterEach(async () => {
    const activeHarness = harness
    harness = undefined
    activeHarness?.adapter?.dispose()
    await activeHarness?.server?.shutdown()
    if (activeHarness?.dir) {
      rmSync(activeHarness.dir, { recursive: true, force: true })
    }
  })

  it('returns unknown without connecting an unreachable daemon', async () => {
    const activeHarness = getHarness()
    const client = (activeHarness.adapter as unknown as { client: DaemonClient }).client
    const request = vi.spyOn(client, 'request')
    const ensureConnected = vi.spyOn(client, 'ensureConnected')

    await expect(activeHarness.adapter.listSessionsIfAlreadyConnected()).resolves.toEqual({
      state: 'unknown',
      reason: 'daemon-disconnected'
    })

    expect(client.isConnected()).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(ensureConnected).not.toHaveBeenCalled()
  })

  it('lists a live PTY through the already authenticated daemon connection', async () => {
    const activeHarness = getHarness()
    const { id } = await activeHarness.adapter.spawn({ cols: 80, rows: 24 })
    const identity = activeHarness.adapter.getDaemonIdentity()
    expect(identity).not.toBeNull()

    const census = await activeHarness.adapter.listSessionsIfAlreadyConnected()

    expect(census).toMatchObject({
      state: 'complete',
      identity,
      agentOwnershipComplete: true,
      sessions: [{ sessionId: id, isAlive: true }]
    })
  })

  it('detects a PTY spawned on the real authenticated daemon after an initially quiet inventory', async () => {
    const activeHarness = getHarness()
    const client = (activeHarness.adapter as unknown as { client: DaemonClient }).client
    // Establish authentication through the adapter's real connection lifecycle
    // (not the raw transport), so its authenticated incarnation is pinned.
    await (
      activeHarness.adapter as unknown as { ensureConnected(): Promise<void> }
    ).ensureConnected()
    expect(client.isConnected()).toBe(true)
    const connect = vi.spyOn(client, 'ensureConnected')
    const initialRead = activeHarness.adapter.listSessionsIfAlreadyConnected.bind(
      activeHarness.adapter
    )
    let reads = 0
    vi.spyOn(activeHarness.adapter, 'listSessionsIfAlreadyConnected').mockImplementation(
      async () => {
        const inventory = await initialRead()
        if (++reads === 1) {
          expect(inventory).toMatchObject({ state: 'complete', sessions: [] })
          await activeHarness.adapter.spawn({ cols: 80, rows: 24 })
        }
        return inventory
      }
    )

    const census = await collectUpdateRuntimeCensus({
      getWindowCount: () => 0,
      getProvider: () => ({
        identity: activeHarness.adapter,
        adapters: [activeHarness.adapter]
      }),
      now: () => 1_800_000_000_000
    })
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census)

    expect(reads).toBe(2)
    expect(census.ptys).toEqual({
      state: 'unknown',
      reason: 'inventory-partial',
      lowerBound: 1
    })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(expect.arrayContaining(['pty-inventory-unknown', 'pty-active']))
    expect(report.activationAvailable).toBe(false)
    // The read-only census must not initiate new connection or session admission.
    expect(connect).toHaveBeenCalledTimes(1) // Only the intentional fixture spawn.
  })

  it('keeps an authenticated agent PTY busy after the last window closes', async () => {
    const activeHarness = getHarness()
    await activeHarness.adapter.spawn({
      cols: 80,
      rows: 24,
      agentSessionEnsure: {
        claim: {
          digestVersion: 1,
          keyId: 'fixture-key',
          identityDigest: 'a'.repeat(43),
          worktreeScopeDigest: 'b'.repeat(43),
          agent: 'codex'
        },
        surface: {
          worktreeId: 'fixture-worktree',
          tabId: 'fixture-tab',
          leafId: '11111111-1111-4111-8111-111111111111',
          terminalHandle: 'term_abcdefgh'
        }
      }
    })
    let windowCount = 1
    const census = () =>
      collectUpdateRuntimeCensus({
        getWindowCount: () => windowCount,
        getProvider: () => ({
          identity: activeHarness.adapter,
          adapters: [activeHarness.adapter]
        }),
        now: () => 1_800_000_000_000
      })

    const beforeClose = await census()
    expect(beforeClose.ptys).toEqual({ state: 'known', count: 1 })
    expect(beforeClose.ptyOwnedAgentSessions).toEqual({ state: 'known', count: 1 })

    windowCount = 0
    const afterClose = await census()
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, afterClose)

    expect(afterClose.windows).toEqual({ state: 'known', count: 0 })
    expect(afterClose.ptys).toEqual({ state: 'known', count: 1 })
    expect(afterClose.ptyOwnedAgentSessions).toEqual({ state: 'known', count: 1 })
    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(expect.arrayContaining(['pty-active', 'agent-session-active']))
    expect(report.blockers).not.toContain('gui-window-active')
    expect(report.activationAvailable).toBe(false)
  })

  it('rejects an inventory response from a replaced daemon incarnation', async () => {
    const activeHarness = getHarness()
    const { id } = await activeHarness.adapter.spawn({ cols: 80, rows: 24 })
    const client = (activeHarness.adapter as unknown as { client: DaemonClient }).client
    const identity = activeHarness.adapter.getDaemonIdentity()
    expect(identity).not.toBeNull()
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      sessions: [
        {
          sessionId: id,
          isAlive: true,
          state: 'running',
          shellState: 'ready',
          pid: 999_999_999,
          cwd: null,
          cols: 80,
          rows: 24,
          createdAt: 0,
          agentSessionOwners: []
        }
      ]
    } as never)
    vi.spyOn(client, 'getDaemonIdentity')
      .mockReturnValueOnce(identity!)
      .mockReturnValueOnce({ ...identity!, launchNonce: 'replacement-incarnation' })

    await expect(activeHarness.adapter.listSessionsIfAlreadyConnected()).resolves.toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed'
    })
  })

  it('treats the same PID with a new start time as a different daemon incarnation', async () => {
    const activeHarness = getHarness()
    const { id } = await activeHarness.adapter.spawn({ cols: 80, rows: 24 })
    const client = (activeHarness.adapter as unknown as { client: DaemonClient }).client
    const identity = activeHarness.adapter.getDaemonIdentity()
    expect(identity).not.toBeNull()
    vi.spyOn(client, 'request').mockResolvedValueOnce({
      sessions: [
        {
          sessionId: id,
          isAlive: true,
          state: 'running',
          shellState: 'ready',
          pid: 123,
          cwd: null,
          cols: 80,
          rows: 24,
          createdAt: 0,
          agentSessionOwners: []
        }
      ]
    } as never)
    vi.spyOn(client, 'getDaemonIdentity')
      .mockReturnValueOnce(identity!)
      .mockReturnValueOnce({ ...identity!, startedAtMs: identity!.startedAtMs + 1 })

    await expect(activeHarness.adapter.listSessionsIfAlreadyConnected()).resolves.toEqual({
      state: 'unknown',
      reason: 'daemon-identity-changed'
    })
  })

  it('treats malformed and failed listSessions replies as unknown without retrying', async () => {
    const activeHarness = getHarness()
    const { id } = await activeHarness.adapter.spawn({ cols: 80, rows: 24 })
    const client = (activeHarness.adapter as unknown as { client: DaemonClient }).client
    const request = vi.spyOn(client, 'request')
    request.mockResolvedValueOnce({ sessions: [{ sessionId: id, isAlive: true }] } as never)

    await expect(activeHarness.adapter.listSessionsIfAlreadyConnected()).resolves.toEqual({
      state: 'unknown',
      reason: 'inventory-invalid'
    })

    request.mockRejectedValueOnce(new Error('listSessions failed'))
    await expect(activeHarness.adapter.listSessionsIfAlreadyConnected()).resolves.toEqual({
      state: 'unknown',
      reason: 'inventory-unavailable'
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(vi.spyOn(client, 'ensureConnected')).not.toHaveBeenCalled()
    expect(activeHarness.adapter.getDaemonIdentity()).not.toBeNull()
  })

  it('allows concurrent read-only censuses without changing attachment state', async () => {
    const activeHarness = getHarness()
    const { id } = await activeHarness.adapter.spawn({ cols: 80, rows: 24 })
    const client = (activeHarness.adapter as unknown as { client: DaemonClient }).client
    const identity = activeHarness.adapter.getDaemonIdentity()

    const results = await Promise.all([
      activeHarness.adapter.listSessionsIfAlreadyConnected(),
      activeHarness.adapter.listSessionsIfAlreadyConnected()
    ])

    expect(results).toHaveLength(2)
    expect(results.every((result) => result.state === 'complete')).toBe(true)
    expect(
      results.flatMap((result) => (result.state === 'complete' ? result.sessions : []))
    ).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: id })]))
    expect(activeHarness.adapter.getDaemonIdentity()).toEqual(identity)
    expect(client.isConnected()).toBe(true)
  })
})
