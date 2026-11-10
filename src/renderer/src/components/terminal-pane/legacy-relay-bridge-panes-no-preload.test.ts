import { afterEach, describe, expect, it, vi } from 'vitest'

describe('legacy relay pane selectors without a preload bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads without dispatching and treats remote-only panes as absent', async () => {
    const api = {}
    vi.stubGlobal('window', { api })

    const panes = await import('./legacy-relay-bridge-panes')

    await expect(panes.legacyRelayBridgedPanesListed()).resolves.toBeUndefined()
    expect(panes.legacyRelayBridgedPane('ssh:box@@pty-1')).toBeUndefined()
    expect(panes.isLegacyRelayBridgedTab('web-terminal-tab-1')).toBe(false)
    expect(panes.hasLegacyRelayBridgedPane('web-terminal-tab-1')).toBe(false)
    expect(
      panes.legacyRelayBridgedPtyIdsForClosingTab('web-terminal-tab-1', ['ssh:box@@pty-1'])
    ).toEqual([])
    expect(
      panes.legacyRelayBridgePtyIdForPane({
        tabId: 'web-terminal-tab-1',
        leafId: null,
        boundPtyId: 'ssh:box@@pty-1'
      })
    ).toBeNull()
    expect(panes.legacyRelayBridgedTabIds('box')).toEqual([])
    expect(api).not.toHaveProperty('legacyRelayBridge')
  })
})
