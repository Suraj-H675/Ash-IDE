import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstalledBrowserExtension } from '../../../../shared/browser/extensions/browser-extension-types'
import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'

const mocks = vi.hoisted(() => ({
  sessions: new Map<string, object>(),
  extensionsBySession: new Map<object, Map<string, object>>(),
  installs: new Map<string, object>(),
  loadInstalled: vi.fn(),
  loadUnpacked: vi.fn(),
  removeExtension: vi.fn()
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => mocks.sessions.get(partition)
  }
}))
vi.mock('../browser-extension-support', () => ({ isBrowserExtensionSupportEnabled: () => true }))
vi.mock('../actions/browser-extension-action-registry', () => ({
  forgetBrowserExtensionActionProfile: vi.fn()
}))
vi.mock('../installation/browser-extension-install-store', () => ({
  getBrowserExtensionInstallStore: () => ({
    list: () => [...mocks.installs.values()],
    get: (id: string) => mocks.installs.get(id) ?? null
  })
}))
vi.mock('../profile-storage/browser-extension-profile-state-store', () => ({
  getBrowserExtensionProfileStateStore: () => ({ forgetProfile: vi.fn() })
}))
vi.mock('../profile-storage/browser-extension-sync-storage-store', () => ({
  getBrowserExtensionSyncStorageStore: () => ({ forgetProfile: vi.fn() })
}))
vi.mock('../declarative-net-request/session/browser-extension-dnr-store', () => ({
  getBrowserExtensionDnrStore: () => ({ forgetProfile: vi.fn() })
}))
vi.mock('../profile-storage/browser-extension-retired-profile-storage', () => ({
  retireBrowserExtensionProfileStorage: vi.fn(async () => undefined)
}))
vi.mock('../api-runtime/browser-extension-api-host', () => ({
  attachBrowserExtensionApiHostToSession: vi.fn(),
  forgetBrowserExtensionContexts: vi.fn()
}))
vi.mock('../profile-storage/browser-extension-data-removal', () => ({
  removeUninstalledBrowserExtensionData: vi.fn(async () => new Set())
}))
vi.mock('./browser-extension-load-errors', () => ({
  clearBrowserExtensionLoadFailure: vi.fn(),
  forgetBrowserExtensionLoadFailures: vi.fn()
}))
vi.mock('./browser-extension-worker-registration', () => ({
  removeBrowserExtensionFromSession: mocks.removeExtension
}))
vi.mock('./browser-extension-session-load', () => ({
  loadInstalledBrowserExtensionIntoSession: mocks.loadInstalled,
  loadBrowserExtensionIntoSession: mocks.loadUnpacked
}))

import {
  attachBrowserExtensionsToProfileSession,
  loadBrowserExtensionIntoProfile,
  setBrowserExtensionSessionHooks,
  unloadBrowserExtensionFromProfile,
  whenBrowserExtensionProfileLoaded
} from './browser-extension-session-loader'

beforeEach(() => {
  mocks.sessions.clear()
  mocks.extensionsBySession.clear()
  mocks.installs.clear()
  vi.clearAllMocks()
  mocks.loadInstalled.mockImplementation(
    async (session: Electron.Session, _profileId: string, installed: InstalledBrowserExtension) => {
      const loaded = { id: installed.id, version: installed.version } as Electron.Extension
      mocks.extensionsBySession.get(session)?.set(installed.id, loaded)
      return loaded
    }
  )
  mocks.loadUnpacked.mockImplementation(
    async (session: Electron.Session, _profileId: string, installed: { id: string }) => {
      const loaded = { id: installed.id, version: '1.0.0' } as Electron.Extension
      mocks.extensionsBySession.get(session)?.set(installed.id, loaded)
      return loaded
    }
  )
  mocks.removeExtension.mockImplementation((session: Electron.Session, extensionId: string) => {
    mocks.extensionsBySession.get(session)?.delete(extensionId)
  })
})

function makeSession(): Electron.Session {
  const extensions = new Map<string, object>()
  const session = {
    extensions: {
      getAllExtensions: () => [...extensions.values()],
      getExtension: (id: string) => extensions.get(id)
    },
    registerPreloadScript: vi.fn(),
    unregisterPreloadScript: vi.fn()
  } as unknown as Electron.Session
  mocks.extensionsBySession.set(session, extensions)
  return session
}

function profile(id: string): BrowserSessionProfile {
  return { id, partition: `persist:${id}`, scope: 'isolated', label: id, source: null }
}

function install(profileId: string, extensionId: string): void {
  const partition = `persist:${profileId}`
  mocks.sessions.set(partition, makeSession())
  mocks.installs.set(extensionId, { id: extensionId, version: '1.0.0', source: 'store' })
  setBrowserExtensionSessionHooks({
    attached: vi.fn(),
    loaded: vi.fn(async () => undefined),
    postLoadFailed: vi.fn(),
    detached: vi.fn(),
    uninstalled: vi.fn()
  })
}

function loadHooks() {
  return {
    attached: vi.fn(),
    loaded: vi.fn(async () => undefined),
    postLoadFailed: vi.fn(),
    detached: vi.fn(),
    uninstalled: vi.fn()
  }
}

describe('browser extension session load hooks', () => {
  it('runs the restore hook once for startup and again after manual disable and re-enable', async () => {
    const extensionId = 'extension-startup-restore'
    const startupProfile = profile('startup-restore-profile')
    const hooks = loadHooks()
    install(startupProfile.id, extensionId)
    setBrowserExtensionSessionHooks(hooks)

    attachBrowserExtensionsToProfileSession(startupProfile, [extensionId])
    await whenBrowserExtensionProfileLoaded(startupProfile.id)

    expect(hooks.loaded).toHaveBeenCalledTimes(1)

    const manualExtensionId = 'extension-manual-restore'
    const manualProfile = profile('manual-restore-profile')
    const manualHooks = loadHooks()
    install(manualProfile.id, manualExtensionId)
    setBrowserExtensionSessionHooks(manualHooks)
    attachBrowserExtensionsToProfileSession(manualProfile, [])
    await whenBrowserExtensionProfileLoaded(manualProfile.id)

    const installed = mocks.installs.get(manualExtensionId) as InstalledBrowserExtension
    await loadBrowserExtensionIntoProfile(manualProfile.id, installed)
    expect(manualHooks.loaded).toHaveBeenCalledTimes(1)

    unloadBrowserExtensionFromProfile(manualProfile.id, manualExtensionId)
    await loadBrowserExtensionIntoProfile(manualProfile.id, installed)

    expect(manualHooks.loaded).toHaveBeenCalledTimes(2)
  })

  it('unloads a newly loaded extension when post-load restoration fails', async () => {
    const extensionId = 'extension-restore-failure'
    const failedProfile = profile('restore-failure-profile')
    const session = makeSession()
    mocks.sessions.set(failedProfile.partition, session)
    const installed = { id: extensionId, version: '1.0.0', source: 'store' }
    mocks.installs.set(extensionId, installed)
    const failure = new Error('native restore failed')
    const hooks = loadHooks()
    hooks.loaded.mockRejectedValue(failure)
    setBrowserExtensionSessionHooks(hooks)
    attachBrowserExtensionsToProfileSession(failedProfile, [])
    await whenBrowserExtensionProfileLoaded(failedProfile.id)

    await expect(
      loadBrowserExtensionIntoProfile(failedProfile.id, installed as InstalledBrowserExtension)
    ).rejects.toBe(failure)

    expect(mocks.removeExtension).toHaveBeenCalledWith(session, extensionId)
    expect(hooks.postLoadFailed).toHaveBeenCalledWith(session, failedProfile.id, extensionId)
    expect(
      (session.extensions as unknown as { getExtension(id: string): unknown }).getExtension(
        extensionId
      )
    ).toBeUndefined()
  })
})
