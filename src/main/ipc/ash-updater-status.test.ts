import { afterEach, expect, it, vi } from 'vitest'
import { registerAshUpdaterReadOnlyHandlers } from './ash-updater-status'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }) => unknown>(),
  trustedSender: { id: 42 },
  isPackaged: false,
  version: '0.0.0-ash-qa',
  windows: 2,
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
    pendingDiskWrites: { state: 'unknown', reason: 'pending-write-census-unavailable' }
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
vi.mock('../updater/update-runtime-census', () => ({
  collectAshUpdateRuntimeCensus: vi.fn(async (getWindowCount: () => number) => ({
    ...fixture.census,
    windows: { state: 'known', count: getWindowCount() }
  }))
}))
vi.mock('./ui', () => ({
  getTrustedUIRendererWebContents: () => fixture.trustedSender
}))

afterEach(() => {
  fixture.handlers.clear()
  fixture.isPackaged = false
  vi.clearAllMocks()
})

it('exposes only trusted read-only Ash updater status and version, with truthful build modes', async () => {
  registerAshUpdaterReadOnlyHandlers()
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
