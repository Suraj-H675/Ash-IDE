import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserBridgeSessionCreation } from './agent-browser-bridge-session-creation'

// Use the actual bridge routing view, which lists only popups belonging to a registered opener.
function existingSession(popupOwnerRegistered: boolean) {
  const openerId = 'opener'
  const pageId = 'popup:22'
  const sessionName = `orca-tab-${pageId}`
  const session = { webContentsId: 22 }
  const bridge = Object.create(AgentBrowserBridgeSessionCreation.prototype) as {
    ensureSession(name: string, pageId: string, webContentsId: number): Promise<void>
    destroySession: ReturnType<typeof vi.fn>
  }
  Object.assign(bridge, {
    browserManager: {
      getWebContentsIdByTabId: () =>
        new Map(popupOwnerRegistered ? [[openerId, 11]] : [['other-page', 33]]),
      getPopupPages: () => [
        { browserPageId: pageId, webContentsId: 22, openerBrowserPageId: openerId }
      ],
      getGuestWebContentsId: () => null
    },
    sessions: new Map([[sessionName, session]]),
    pendingSessionCreation: new Map(),
    pendingSessionDestruction: new Map(),
    assertCommandAdmission: vi.fn()
  })
  const destroySession = vi.fn()
  bridge.destroySession = destroySession
  return {
    ensure: (webContentsId: number): Promise<void> =>
      bridge.ensureSession(sessionName, pageId, webContentsId),
    destroySession
  }
}

describe('bridge session ownership for popup pages', () => {
  it('accepts an existing session for the exact registered popup owner', async () => {
    const fixture = existingSession(true)
    await expect(fixture.ensure(22)).resolves.toBeUndefined()
    expect(fixture.destroySession).not.toHaveBeenCalled()
  })

  it('rejects an unregistered opener without closing a different live session', async () => {
    const fixture = existingSession(false)
    await expect(fixture.ensure(22)).rejects.toMatchObject({ code: 'browser_tab_not_found' })
    expect(fixture.destroySession).not.toHaveBeenCalled()
  })

  it('rejects an incorrect WebContents incarnation', async () => {
    const fixture = existingSession(true)
    await expect(fixture.ensure(23)).rejects.toMatchObject({ code: 'browser_tab_not_found' })
    expect(fixture.destroySession).not.toHaveBeenCalled()
  })
})
