import '../../../pty-subprocess/testing/mock-descendant-sweep'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from '../../../transport/client/daemon-client'
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
