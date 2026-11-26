import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const mocks = vi.hoisted(() => ({
  detach: vi.fn<() => Promise<void>>(),
  attach: vi.fn(),
  changed: vi.fn(),
  profiles: [{ id: 'local-fixture-profile', partition: 'persist:local-fixture-profile' }]
}))
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  webContents: { getAllWebContents: () => [] }
}))
vi.mock('./profile-storage/browser-extension-retired-profile-storage', () => ({
  removeRetiredBrowserExtensionProfileStorage: vi.fn(async () => {})
}))
vi.mock('./api-runtime/browser-extension-native-page', () => ({
  isBrowserExtensionNativePage: vi.fn(() => false)
}))
vi.mock('./api-runtime/browser-extension-api-host', () => ({
  installBrowserExtensionApiHost: vi.fn(),
  getBrowserExtensionProfileIdForSession: vi.fn()
}))
vi.mock('../sessions/browser-session-registry', () => ({
  browserSessionRegistry: { listProfiles: () => mocks.profiles, getEnabledExtensionIds: () => [] }
}))
vi.mock('./profile-sessions/browser-extension-session-loader', () => ({
  attachBrowserExtensionsToProfileSession: mocks.attach,
  detachBrowserExtensionsFromAllProfileSessions: mocks.detach
}))
vi.mock('./actions/browser-extension-action-registry', () => ({
  notifyBrowserExtensionActionsChanged: vi.fn()
}))
vi.mock('./register-browser-extension-namespaces', () => ({
  registerBrowserExtensionNamespaces: vi.fn()
}))
vi.mock('./api/tabs-lifecycle', () => ({ observeBrowserExtensionTabLifecycle: vi.fn() }))
vi.mock('./api/web-navigation', () => ({ observeBrowserExtensionWebNavigation: vi.fn() }))
vi.mock('./api/commands', () => ({ observeBrowserExtensionCommands: vi.fn() }))
vi.mock('./declarative-net-request/session/browser-extension-dnr-contents', () => ({
  observeBrowserExtensionDnrContents: vi.fn()
}))
vi.mock('./profile-sessions/browser-extension-session-services', () => ({
  installBrowserExtensionSessionServices: vi.fn()
}))
vi.mock('./actions/browser-extension-toolbar', () => ({
  installBrowserExtensionToolbarNotifications: vi.fn()
}))
vi.mock('./web-store/browser-extension-webstore-bridge-host', () => ({
  installChromeWebStoreBridgeHost: vi.fn()
}))
vi.mock('./web-store/browser-extension-webstore-updater', () => ({
  startBrowserExtensionUpdateChecks: vi.fn()
}))
vi.mock('./installation/browser-extension-list-changes', () => ({
  notifyBrowserExtensionListChanged: mocks.changed,
  setBrowserExtensionListChangedListener: vi.fn()
}))
vi.mock('./tabs-and-windows/browser-extension-window-model', () => ({
  getBrowserExtensionMainWindow: () => null
}))
vi.mock('./tabs-and-windows/browser-extension-discarded-tabs', () => ({
  setSavedBrowserTabsSource: vi.fn()
}))

import {
  retryBrowserExtensionSupportTransition,
  switchBrowserExtensionSupport
} from './browser-extension-startup'
import { requestBrowserExtensionInstallPrompt } from './permissions/browser-extension-install-prompt'
import {
  getBrowserExtensionSupportStatus,
  isBrowserExtensionSupportEnabled,
  setBrowserExtensionSupportEnabled,
  withBrowserExtensionMutation
} from './browser-extension-support'

beforeEach(() => {
  vi.resetAllMocks()
  setBrowserExtensionSupportEnabled(true)
  mocks.detach.mockResolvedValue(undefined)
})

describe('global browser extension support transition', () => {
  it('retries a failed native disable rather than treating the admission flag as completion', async () => {
    mocks.detach.mockRejectedValueOnce(new Error('Native extension remains loaded'))
    await switchBrowserExtensionSupport(false).catch(() => {})
    expect(isBrowserExtensionSupportEnabled()).toBe(false)
    expect(getBrowserExtensionSupportStatus()).toEqual({
      desiredEnabled: false,
      runtime: 'unload-failed'
    })
    await retryBrowserExtensionSupportTransition()
    expect(mocks.detach).toHaveBeenCalledTimes(2)
    expect(getBrowserExtensionSupportStatus().runtime).toBe('disabled')
  })

  it('does not reopen extension authority while previous native retirement still fails', async () => {
    mocks.detach.mockRejectedValue(new Error('Native extension remains loaded'))
    await switchBrowserExtensionSupport(false).catch(() => {})
    await switchBrowserExtensionSupport(true).catch(() => {})
    expect(isBrowserExtensionSupportEnabled()).toBe(false)
    expect(mocks.attach).not.toHaveBeenCalled()
    expect(getBrowserExtensionSupportStatus()).toEqual({
      desiredEnabled: true,
      runtime: 'unload-failed'
    })
  })

  it('keeps admission closed until a pending disable finishes before applying re-enable', async () => {
    let release!: () => void
    const draining = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.detach.mockImplementationOnce(() => draining)

    const disabling = switchBrowserExtensionSupport(false)
    expect(isBrowserExtensionSupportEnabled()).toBe(false)
    expect(getBrowserExtensionSupportStatus().runtime).toBe('disabling')
    const enabling = switchBrowserExtensionSupport(true)
    expect(getBrowserExtensionSupportStatus()).toEqual({
      desiredEnabled: true,
      runtime: 'disabling'
    })
    expect(mocks.attach).not.toHaveBeenCalled()

    release()
    await Promise.all([disabling, enabling])
    expect(mocks.attach).toHaveBeenCalledOnce()
    expect(getBrowserExtensionSupportStatus()).toEqual({
      desiredEnabled: true,
      runtime: 'enabled'
    })
  })

  it('aborts and drains admitted mutations before native retirement starts', async () => {
    let signal!: AbortSignal
    let finish!: () => void
    let started!: () => void
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const mutation = withBrowserExtensionMutation(async (activeSignal) => {
      signal = activeSignal
      started()
      await pending
    })
    await began

    const disabling = switchBrowserExtensionSupport(false)
    expect(signal.aborted).toBe(true)
    await expect(
      withBrowserExtensionMutation(async () => {
        throw new Error('new mutation should not run')
      })
    ).rejects.toThrow('unavailable')
    expect(mocks.detach).not.toHaveBeenCalled()

    finish()
    await Promise.all([mutation, disabling])
    expect(mocks.detach).toHaveBeenCalledOnce()
  })

  it('closes a pending install prompt so disable does not wait for a user response', async () => {
    let promptSent!: () => void
    const sent = new Promise<void>((resolve) => {
      promptSent = resolve
    })
    const renderer = Object.assign(new EventEmitter(), {
      id: 4,
      isDestroyed: () => false,
      send: vi.fn(() => promptSent())
    }) as unknown as Electron.WebContents
    const prompt = withBrowserExtensionMutation((signal) =>
      requestBrowserExtensionInstallPrompt(
        renderer,
        {
          kind: 'install',
          name: 'Fixture',
          iconDataUrl: null,
          permissions: [],
          hostPermissions: [],
          profileLabel: null
        },
        undefined,
        signal
      )
    )
    await sent

    const disabling = switchBrowserExtensionSupport(false)
    await expect(prompt).resolves.toBe(false)
    await disabling
    expect(renderer.send).toHaveBeenCalledTimes(2)
    expect(mocks.detach).toHaveBeenCalledOnce()
  })
})
