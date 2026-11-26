import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabledByProfile: {} as Record<string, string[]>,
  sessions: new Map<string, object>(),
  hooks: null as unknown
}))

vi.mock('../../sessions/browser-session-registry', () => ({
  browserSessionRegistry: {
    updateEnabledExtensionIds: (
      update: (byProfile: Record<string, string[]>) => Record<string, string[]>
    ) => {
      mocks.enabledByProfile = update(mocks.enabledByProfile)
    }
  }
}))
vi.mock('electron', () => ({ webContents: { fromId: vi.fn(() => null) } }))
vi.mock('../../browser-manager', () => ({
  browserManager: { setUnownedDownloadOwnerResolver: vi.fn() }
}))
vi.mock('../api/cookies', () => ({ observeBrowserExtensionCookieChanges: vi.fn() }))
vi.mock('../actions/browser-extension-action-registry', () => ({
  observeBrowserExtensionActionSession: vi.fn()
}))
vi.mock('../permissions/browser-extension-active-tab', () => ({
  revokeBrowserExtensionActiveTabInSession: vi.fn()
}))
vi.mock('../api-runtime/browser-extension-api-host', () => ({
  getBrowserExtensionProfileIdForSession: vi.fn(() => null)
}))
vi.mock('../tabs-and-windows/browser-extension-tab-model', () => ({
  getActiveBrowserTabId: vi.fn(() => null)
}))
vi.mock('../api-runtime/browser-extension-content-scripts', () => ({
  forgetBrowserExtensionContentScriptRestore: vi.fn(),
  restoreBrowserExtensionContentScripts: vi.fn(async () => undefined)
}))
vi.mock('../../sessions/requests/browser-session-request-decisions', () => ({
  setBrowserSessionRequestDecider: vi.fn()
}))
vi.mock('../declarative-net-request/session/browser-extension-dnr-requests', () => ({
  browserExtensionDnrRequestDecider: vi.fn()
}))
vi.mock('../declarative-net-request/session/browser-extension-dnr-session', () => ({
  attachBrowserExtensionDnr: vi.fn(),
  whenBrowserExtensionDnrLoaded: vi.fn(async () => undefined)
}))
vi.mock('./browser-extension-session-loader', () => ({
  getBrowserExtensionSessionForProfile: (profileId: string) => mocks.sessions.get(profileId),
  setBrowserExtensionSessionHooks: (hooks: unknown) => {
    mocks.hooks = hooks
  }
}))
vi.mock('../browser-extension-web-request', () => ({
  installBrowserExtensionWebRequestForwarding: vi.fn(),
  observeBrowserExtensionWebRequests: vi.fn(),
  stopObservingBrowserExtensionWebRequests: vi.fn()
}))

import { installBrowserExtensionSessionServices } from './browser-extension-session-services'

beforeEach(() => {
  mocks.enabledByProfile = {}
  mocks.sessions.clear()
  mocks.hooks = null
  vi.clearAllMocks()
})

describe('browser extension session restore failures', () => {
  it('disables only the failed extension in its still-attached profile', () => {
    const extensionId = 'failed-extension'
    const unrelatedId = 'unrelated-extension'
    const profileSession = {}
    mocks.enabledByProfile = {
      'profile-a': [extensionId, unrelatedId],
      'profile-b': [extensionId]
    }
    mocks.sessions.set('profile-a', profileSession)
    installBrowserExtensionSessionServices()

    const hooks = mocks.hooks as {
      postLoadFailed: (session: object, profileId: string, id: string) => void
    }
    hooks.postLoadFailed(profileSession, 'profile-a', extensionId)

    expect(mocks.enabledByProfile).toEqual({
      'profile-a': [unrelatedId],
      'profile-b': [extensionId]
    })

    hooks.postLoadFailed({}, 'profile-a', unrelatedId)
    expect(mocks.enabledByProfile['profile-a']).toEqual([unrelatedId])

    hooks.postLoadFailed({}, 'profile-c', 'not-enabled')
    expect(mocks.enabledByProfile).toEqual({
      'profile-a': [unrelatedId],
      'profile-b': [extensionId]
    })
  })
})
