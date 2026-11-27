import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncRuntimeGraph: vi.fn(),
  setTrailingGraphSyncScheduler: vi.fn()
}))

vi.mock('./sync-runtime-graph/graph-publication', () => ({
  syncRuntimeGraph: mocks.syncRuntimeGraph,
  setTrailingGraphSyncScheduler: mocks.setTrailingGraphSyncScheduler
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

import { useAppStore } from '@/store'
import {
  flushRuntimeGraphSync,
  setRuntimeGraphStoreStateGetter,
  setRuntimeGraphSyncEnabled
} from './sync-runtime-graph'
import { graphState } from './sync-runtime-graph/graph-state'

function deferred() {
  let resolve!: (result: boolean) => void
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('flushRuntimeGraphSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setRuntimeGraphSyncEnabled(false)
    graphState.syncInFlight = false
    graphState.syncPendingAfterFlight = false
    mocks.syncRuntimeGraph.mockReset()
    mocks.syncRuntimeGraph.mockResolvedValue(true)
    setRuntimeGraphStoreStateGetter(useAppStore.getState)
    setRuntimeGraphSyncEnabled(true)
  })

  afterEach(() => {
    setRuntimeGraphSyncEnabled(false)
    setRuntimeGraphStoreStateGetter(null)
    vi.useRealTimers()
  })

  it('replaces the coalesced timer with an immediate accepted snapshot', async () => {
    await flushRuntimeGraphSync()
    await vi.advanceTimersByTimeAsync(16)

    expect(mocks.syncRuntimeGraph).toHaveBeenCalledOnce()
    expect(graphState.syncTimer).toBeNull()
  })

  it('waits for an older in-flight snapshot, then publishes the latest state', async () => {
    const earlierPublication = deferred()
    const closePublication = deferred()
    let startClosePublication!: () => void
    const closePublicationStarted = new Promise<void>((resolve) => {
      startClosePublication = resolve
    })
    mocks.syncRuntimeGraph
      .mockReturnValueOnce(earlierPublication.promise)
      .mockImplementationOnce(() => {
        startClosePublication()
        return closePublication.promise
      })

    await vi.advanceTimersByTimeAsync(16)
    expect(mocks.syncRuntimeGraph).toHaveBeenCalledOnce()

    let flushSettled = false
    const closeCompletion = flushRuntimeGraphSync().then(() => {
      flushSettled = true
    })
    earlierPublication.resolve(true)
    await closePublicationStarted

    expect(mocks.syncRuntimeGraph).toHaveBeenCalledTimes(2)
    expect(flushSettled).toBe(false)

    closePublication.resolve(true)
    await closeCompletion
    expect(flushSettled).toBe(true)
  })
})
