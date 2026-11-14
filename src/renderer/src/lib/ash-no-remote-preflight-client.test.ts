// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createPreflightApi } from '@/web/preload-api/web-host-capability-api'
import { readWindowsTerminalCapabilities } from './windows-terminal-capability-read'
import { createDetectedAgentsSlice } from '@/store/slices/detected-agents'

describe('Ash renderer never probes managed SSH hosts during preflight', () => {
  it('does not expose remote-development preflight methods to browser clients', () => {
    const methods = Object.keys(createPreflightApi())
    expect(methods).not.toContain('detectRemoteAgents')
    expect(methods).not.toContain('detectRemoteWindowsTerminalCapabilities')
    expect(methods).toContain('detectAgents')
    expect(methods).toContain('refreshAgents')
  })

  it('does not call the local or remote preflight bridge when given a historical SSH target', async () => {
    const legacy = await readWindowsTerminalCapabilities(
      { kind: 'environment', environmentId: 'legacy-remote-host' },
      'retired-ssh-connection'
    )
    expect(legacy).toEqual({
      wslAvailable: false,
      wslDistros: [],
      pwshAvailable: false,
      gitBashAvailable: false,
      hostPlatform: null,
      isLoading: false
    })
  })

  it('does not refresh historical remote agent state or report it as newly detected', async () => {
    const set = vi.fn()
    const get = vi.fn(() => ({
      remoteDetectedAgentIds: { 'retired-ssh-connection': ['codex'] }
    }))
    const slice = createDetectedAgentsSlice(
      set as never,
      get as never,
      {
        subscribe: vi.fn(() => () => undefined)
      } as never
    )

    expect(await slice.ensureRemoteDetectedAgents('retired-ssh-connection')).toEqual([])
    expect(slice.remoteAgentInventoryOutcome('retired-ssh-connection')).toBe('failed')
    expect(await slice.refreshRemoteDetectedAgents('retired-ssh-connection')).toEqual([])
    expect(set).not.toHaveBeenCalled()
  })
})
