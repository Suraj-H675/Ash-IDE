import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ handle: vi.fn(), invoke: vi.fn(), on: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: electron, ipcRenderer: electron }))

import { registerPreflightHandlers } from './preflight'
import { preflightApi } from '../../preload/api/preflight-bridge'

const unavailable = [
  'preflight:detectRemoteAgents',
  'preflight:detectRemoteWindowsTerminalCapabilities'
] as const

describe('Ash local-only agent preflight', () => {
  it('does not register remote-managed agent or Windows terminal IPC handlers', () => {
    registerPreflightHandlers()
    const names = new Set(electron.handle.mock.calls.map(([name]) => name as string))
    for (const channel of unavailable) {
      expect(names.has(channel), `${channel} should not be reachable`).toBe(false)
    }
    expect(names.has('preflight:check')).toBe(true)
    expect(names.has('preflight:detectAgents')).toBe(true)
    expect(names.has('preflight:refreshAgents')).toBe(true)
  })

  it('excludes remote development methods from the native preload API', () => {
    const names = Object.keys(preflightApi)
    expect(names).not.toContain('detectRemoteAgents')
    expect(names).not.toContain('detectRemoteWindowsTerminalCapabilities')
    expect(names).toContain('detectAgents')
    expect(names).toContain('refreshAgents')
  })
})
