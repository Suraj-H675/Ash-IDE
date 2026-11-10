import { afterEach, expect, it, vi } from 'vitest'
import { registerAshUpdaterReadOnlyHandlers } from './ash-updater-status'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }) => unknown>(),
  trustedSender: { id: 42 },
  isPackaged: false,
  version: '0.0.0-ash-qa'
}))

vi.mock('electron', () => ({
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
vi.mock('./ui', () => ({
  getTrustedUIRendererWebContents: () => fixture.trustedSender
}))

afterEach(() => {
  fixture.handlers.clear()
  fixture.isPackaged = false
  vi.clearAllMocks()
})

it('exposes only trusted read-only Ash updater status and version, with truthful build modes', () => {
  registerAshUpdaterReadOnlyHandlers()
  expect([...fixture.handlers.keys()].sort()).toEqual(['updater:getStatus', 'updater:getVersion'])
  const getStatus = fixture.handlers.get('updater:getStatus')!
  const getVersion = fixture.handlers.get('updater:getVersion')!

  expect(getStatus({ sender: fixture.trustedSender })).toEqual({
    state: 'unavailable',
    reason: 'source-build'
  })
  expect(getVersion({ sender: fixture.trustedSender })).toBe('0.0.0-ash-qa')

  fixture.isPackaged = true
  expect(getStatus({ sender: fixture.trustedSender })).toEqual({
    state: 'unavailable',
    reason: 'not-configured'
  })

  for (const listener of [getStatus, getVersion]) {
    expect(() => listener({ sender: { id: 99 } })).toThrow(/Unauthorized Ash updater/)
  }
})
