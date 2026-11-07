import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, () => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: () => unknown) => handlers.set(channel, handler))
  }
}))

import { registerAshLocalEnvironmentQueries } from './ash-local-environment-queries'

describe('Ash local-only environment IPC', () => {
  beforeEach(() => handlers.clear())

  it('serves only empty read-only catalogs and does not register pairing or remote control', () => {
    registerAshLocalEnvironmentQueries()
    expect([...handlers.keys()].sort()).toEqual([
      'runtimeEnvironments:desktopCreatedChatIds',
      'runtimeEnvironments:getStatusSnapshots',
      'runtimeEnvironments:list'
    ])
    for (const handler of handlers.values()) {
      expect(handler()).toEqual([])
    }
    expect(handlers.has('runtimeEnvironments:addFromPairingCode')).toBe(false)
    expect(handlers.has('runtimeEnvironments:connect')).toBe(false)
    expect(handlers.has('runtimeEnvironments:deployOrcad')).toBe(false)
  })
})
