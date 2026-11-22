import { afterEach, expect, it, vi } from 'vitest'
import { registerAshUpdaterReadOnlyHandlers } from './ash-updater-status'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }) => unknown>(),
  trustedSender: { id: 42 },
  isPackaged: false,
  version: '0.0.0-ash-qa',
  windows: 2,
  localPendingWrite: false,
  census: {
    observedAtMs: 1,
    hostOwnership: { state: 'unknown', reason: 'exclusive-host-ownership-unavailable' },
    daemonGenerations: { state: 'unknown', reason: 'daemon-unavailable', lowerBound: 0 },
    windows: { state: 'known', count: 2 },
    ptys: { state: 'unknown', reason: 'daemon-unavailable', lowerBound: 0 },
    ptyOwnedAgentSessions: {
      state: 'unknown',
      reason: 'daemon-unavailable',
      lowerBound: 0
    },
    providerAgentSessions: {
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable'
    },
    browserBackends: {
      state: 'unknown',
      reason: 'browser-backend-inventory-unavailable',
      lowerBound: 0
    },
    pendingDiskWrites: {
      state: 'unknown',
      reason: 'pending-write-census-unavailable',
      lowerBound: 0
    }
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => Array.from({ length: fixture.windows })) },
  ipcMain: {
    handle: vi.fn((channel: string, listener: (event: { sender: unknown }) => unknown) => {
      fixture.handlers.set(channel, listener)
    })
  },
  app: {
    get isPackaged() {
      return fixture.isPackaged
    },
    getVersion: vi.fn(() => fixture.version)
  }
}))
vi.mock('../updater/update-runtime-ash-census', () => ({
  collectAshUpdateRuntimeCensus: vi.fn(
    async (getWindowCount: () => number, getLocalPendingWriteActivity: () => boolean) => ({
      ...fixture.census,
      windows: { state: 'known', count: getWindowCount() },
      pendingDiskWrites: {
        state: 'unknown',
        reason: 'pending-write-census-unavailable',
        lowerBound: getLocalPendingWriteActivity() ? 1 : 0
      }
    })
  )
}))
vi.mock('./ui', () => ({
  getTrustedUIRendererWebContents: () => fixture.trustedSender
}))

afterEach(() => {
  fixture.handlers.clear()
  fixture.isPackaged = false
  fixture.windows = 2
  fixture.localPendingWrite = false
  vi.clearAllMocks()
})

it('exposes only trusted read-only Ash updater status and version, with truthful build modes', async () => {
  registerAshUpdaterReadOnlyHandlers({
    hasObservedPendingLocalWrite: () => fixture.localPendingWrite
  })
  expect([...fixture.handlers.keys()].sort()).toEqual([
    'updater:getPreflight',
    'updater:getStatus',
    'updater:getVersion'
  ])
  const getStatus = fixture.handlers.get('updater:getStatus')!
  const getVersion = fixture.handlers.get('updater:getVersion')!
  const getPreflight = fixture.handlers.get('updater:getPreflight')!

  expect(getStatus({ sender: fixture.trustedSender })).toEqual({
    state: 'unavailable',
    reason: 'source-build'
  })
  expect(getVersion({ sender: fixture.trustedSender })).toBe('0.0.0-ash-qa')
  await expect(getPreflight({ sender: fixture.trustedSender })).resolves.toMatchObject({
    decision: 'busy',
    activationAvailable: false,
    runtime: { windows: { state: 'known', count: 2 } },
    blockers: expect.arrayContaining(['candidate-not-provided', 'gui-window-active'])
  })

  fixture.isPackaged = true
  expect(getStatus({ sender: fixture.trustedSender })).toEqual({
    state: 'unavailable',
    reason: 'not-configured'
  })

  for (const listener of [getStatus, getVersion, getPreflight]) {
    await expect(Promise.resolve().then(() => listener({ sender: { id: 99 } }))).rejects.toThrow(
      /Unauthorized Ash updater/
    )
  }
})

it('reports observed local Store persistence as busy through trusted IPC only', async () => {
  fixture.windows = 0
  fixture.localPendingWrite = true
  const store = { hasObservedPendingLocalWrite: vi.fn(() => fixture.localPendingWrite) }
  registerAshUpdaterReadOnlyHandlers(store)
  const handler = fixture.handlers.get('updater:getPreflight')!

  await expect(handler({ sender: { id: 1000 } })).rejects.toThrow(/Unauthorized Ash updater/)
  expect(store.hasObservedPendingLocalWrite).not.toHaveBeenCalled()

  const busy = await handler({ sender: fixture.trustedSender })
  expect(busy).toMatchObject({
    decision: 'busy',
    activationAvailable: false,
    runtime: {
      windows: { state: 'known', count: 0 },
      pendingDiskWrites: { state: 'unknown', lowerBound: 1 }
    },
    blockers: expect.arrayContaining([
      'pending-disk-writes-observed',
      'pending-disk-writes-unknown'
    ])
  })
  fixture.localPendingWrite = false
  const quiet = await handler({ sender: fixture.trustedSender })
  expect(quiet).toMatchObject({
    decision: 'defer',
    activationAvailable: false,
    runtime: { pendingDiskWrites: { state: 'unknown', lowerBound: 0 } }
  })
  expect(store.hasObservedPendingLocalWrite).toHaveBeenCalledTimes(2)
})
