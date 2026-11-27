import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'
import type { InstalledBrowserExtension } from '../../../../shared/browser/extensions/browser-extension-types'

const mocks = vi.hoisted(() => ({
  enabledByProfile: Object.fromEntries<string[]>([]),
  sessions: new Map<string, object>(),
  installs: new Map<string, object>(),
  restore: vi.fn(),
  cancelRestore: (): void => {},
  prepareDirectory: vi.fn(),
  loadInstalled: vi.fn(),
  removeExtension: vi.fn()
}))

vi.mock('electron', () => ({
  session: { fromPartition: (partition: string) => mocks.sessions.get(partition) },
  webContents: { fromId: vi.fn(() => null) }
}))
vi.mock('node:fs', () => ({ existsSync: () => false }))
vi.mock('../../../../../src/main/browser/sessions/browser-session-registry', () => ({
  browserSessionRegistry: {
    listProfiles: () => Object.keys(mocks.enabledByProfile).map((id) => ({ id })),
    getEnabledExtensionIds: (profileId: string) => mocks.enabledByProfile[profileId] ?? [],
    updateEnabledExtensionIds: (
      update: (byProfile: Record<string, string[]>) => Record<string, string[]>
    ) => {
      mocks.enabledByProfile = update(mocks.enabledByProfile)
    }
  }
}))
vi.mock('../../../../../src/main/browser/extensions/browser-extension-support', () => ({
  isBrowserExtensionSupportEnabled: () => true,
  isBrowserExtensionMutationPaused: () => false,
  pauseBrowserExtensionMutations: async () => () => {}
}))
vi.mock(
  '../../../../../src/main/browser/extensions/installation/browser-extension-install-store',
  () => ({
    getBrowserExtensionInstallStore: () => ({
      list: () => [...mocks.installs.values()],
      get: (id: string) => mocks.installs.get(id) ?? null
    })
  })
)
vi.mock(
  '../../../../../src/main/browser/extensions/profile-storage/browser-extension-profile-state-store',
  () => ({
    getBrowserExtensionProfileStateStore: () => ({
      forgetProfile: vi.fn(),
      read: () => ({ workerSignature: null }),
      update: vi.fn()
    })
  })
)
vi.mock(
  '../../../../../src/main/browser/extensions/profile-storage/browser-extension-sync-storage-store',
  () => ({ getBrowserExtensionSyncStorageStore: () => ({ forgetProfile: vi.fn() }) })
)
vi.mock(
  '../../../../../src/main/browser/extensions/declarative-net-request/session/browser-extension-dnr-store',
  () => ({ getBrowserExtensionDnrStore: () => ({ forgetProfile: vi.fn() }) })
)
vi.mock(
  '../../../../../src/main/browser/extensions/profile-storage/browser-extension-retired-profile-storage',
  () => ({ retireBrowserExtensionProfileStorage: vi.fn(async () => undefined) })
)
vi.mock(
  '../../../../../src/main/browser/extensions/api-runtime/browser-extension-api-host',
  () => ({
    attachBrowserExtensionApiHostToSession: vi.fn(),
    forgetBrowserExtensionContexts: vi.fn(),
    forgetExtensionContexts: vi.fn(),
    getBrowserExtensionProfileIdForSession: vi.fn(() => null)
  })
)
vi.mock(
  '../../../../../src/main/browser/extensions/profile-storage/browser-extension-data-removal',
  () => ({ removeUninstalledBrowserExtensionData: vi.fn(async () => new Set()) })
)
vi.mock(
  '../../../../../src/main/browser/extensions/profile-sessions/browser-extension-load-errors',
  () => ({
    clearBrowserExtensionLoadFailure: vi.fn(),
    forgetBrowserExtensionLoadFailures: vi.fn(),
    recordBrowserExtensionLoadFailure: vi.fn()
  })
)
vi.mock(
  '../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-load',
  () => ({
    loadInstalledBrowserExtensionIntoSession: mocks.loadInstalled,
    loadBrowserExtensionIntoSession: mocks.loadInstalled
  })
)
vi.mock(
  '../../../../../src/main/browser/extensions/installation/browser-extension-load-directory',
  () => ({ prepareBrowserExtensionDirectory: mocks.prepareDirectory })
)
vi.mock('../../../../../src/main/browser/extensions/api/cookies', () => ({
  observeBrowserExtensionCookieChanges: vi.fn()
}))
vi.mock(
  '../../../../../src/main/browser/extensions/actions/browser-extension-action-registry',
  () => ({
    observeBrowserExtensionActionSession: vi.fn(),
    forgetBrowserExtensionActionProfile: vi.fn()
  })
)
vi.mock(
  '../../../../../src/main/browser/extensions/permissions/browser-extension-active-tab',
  () => ({ revokeBrowserExtensionActiveTabInSession: vi.fn() })
)
vi.mock(
  '../../../../../src/main/browser/extensions/tabs-and-windows/browser-extension-tab-model',
  () => ({ getActiveBrowserTabId: vi.fn(() => null) })
)
vi.mock(
  '../../../../../src/main/browser/extensions/api-runtime/browser-extension-content-scripts',
  () => ({
    forgetBrowserExtensionContentScriptRestore: () => mocks.cancelRestore?.(),
    restoreBrowserExtensionContentScripts: mocks.restore
  })
)
vi.mock(
  '../../../../../src/main/browser/sessions/requests/browser-session-request-decisions',
  () => ({ setBrowserSessionRequestDecider: vi.fn() })
)
vi.mock(
  '../../../../../src/main/browser/extensions/declarative-net-request/session/browser-extension-dnr-requests',
  () => ({ browserExtensionDnrRequestDecider: vi.fn() })
)
vi.mock(
  '../../../../../src/main/browser/extensions/declarative-net-request/session/browser-extension-dnr-session',
  () => ({
    attachBrowserExtensionDnr: vi.fn(),
    whenBrowserExtensionDnrLoaded: vi.fn(async () => undefined)
  })
)
vi.mock('../../../../../src/main/browser/browser-manager', () => ({
  browserManager: { setUnownedDownloadOwnerResolver: vi.fn() }
}))
vi.mock('../../../../../src/main/browser/extensions/browser-extension-web-request', () => ({
  installBrowserExtensionWebRequestForwarding: vi.fn(),
  observeBrowserExtensionWebRequests: vi.fn(),
  stopObservingBrowserExtensionWebRequests: vi.fn()
}))

beforeEach(() => {
  mocks.enabledByProfile = { 'profile-a': ['race-extension'] }
  mocks.sessions.clear()
  mocks.installs.clear()
  mocks.restore.mockReset()
  mocks.loadInstalled.mockReset()
  mocks.removeExtension.mockReset()
  mocks.prepareDirectory.mockReset()
  mocks.cancelRestore = (): void => {}
})

function profileWithId(id: string): BrowserSessionProfile {
  return {
    id,
    partition: `persist:${id}`,
    scope: 'isolated' as const,
    label: id,
    source: null
  }
}

function installedExtension(id: string): InstalledBrowserExtension {
  return {
    id,
    name: id,
    version: '1.0.0',
    path: `/extensions/${id}`,
    source: 'webstore',
    iconPath: null,
    permissions: [],
    hostPermissions: [],
    optionsPage: null
  }
}

function nativeExtension(id: string, version = '1.0.0'): Electron.Extension {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: lifecycle fixtures inspect only extension identity and version; Electron native behavior is mocked.
  return { id, version } as Electron.Extension
}

function createSession(
  extensions: Map<string, Electron.Extension>,
  unloaded: { callback?: (event: unknown, extension: Electron.Extension) => void }
): Electron.Session {
  let sess: Electron.Session
  const session = {
    extensions: {
      getAllExtensions: () => [...extensions.values()],
      getExtension: (id: string) => extensions.get(id),
      removeExtension: (id: string) => mocks.removeExtension(sess, id),
      on: vi.fn(
        (_event: string, listener: (event: unknown, extension: Electron.Extension) => void) => {
          unloaded.callback = listener
        }
      )
    },
    registerPreloadScript: vi.fn(),
    unregisterPreloadScript: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test session implements only extension registry and preload methods exercised by this loader lifecycle.
  sess = session as unknown as Electron.Session
  return sess
}

describe('reload during startup restore', () => {
  it('keeps desired enablement and reloads after startup restoration is superseded', async () => {
    const extensionId = 'race-extension'
    const installed = installedExtension(extensionId)
    const profile = profileWithId('profile-a')
    const extensions = new Map<string, Electron.Extension>()
    const extensionEvents: { callback?: (event: unknown, extension: Electron.Extension) => void } =
      {}
    const sess = createSession(extensions, extensionEvents)
    mocks.sessions.set(profile.partition, sess)
    mocks.installs.set(extensionId, installed)
    mocks.loadInstalled.mockImplementation(async () => {
      const loaded = nativeExtension(extensionId)
      extensions.set(extensionId, loaded)
      return loaded
    })
    let started!: () => void
    let prepareStarted!: () => void
    let releasePrepare!: () => void
    const startedRestore = new Promise<void>((resolve) => (started = resolve))
    const startedPreparation = new Promise<void>((resolve) => (prepareStarted = resolve))
    const prepareGate = new Promise<void>((resolve) => (releasePrepare = resolve))
    mocks.prepareDirectory.mockImplementation(async () => {
      prepareStarted()
      await prepareGate
    })
    mocks.restore.mockImplementation(async () => {
      if (mocks.restore.mock.calls.length === 1) {
        started()
        return await new Promise<never>((_resolve, reject) => {
          mocks.cancelRestore = () => reject(new Error('Extension context was unloaded'))
        })
      }
    })
    mocks.removeExtension.mockImplementation((_session: object, id: string) => {
      const removed = extensions.get(id)
      extensions.delete(id)
      if (removed) {
        extensionEvents.callback?.({}, removed)
      }
    })

    const loader =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-loader')
    const services =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-services')
    const reload =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-profile-reload')
    services.installBrowserExtensionSessionServices()
    loader.attachBrowserExtensionsToProfileSession(profile, [extensionId])

    await startedRestore
    const reloading = reload.reloadBrowserExtensionWhereEnabled(installed, {
      refresh: true
    })
    await startedPreparation
    await loader.whenBrowserExtensionProfileLoaded(profile.id)
    releasePrepare()
    await reloading

    expect(mocks.enabledByProfile['profile-a']).toEqual([extensionId])
    expect(mocks.loadInstalled).toHaveBeenCalledTimes(2)
    expect(mocks.restore).toHaveBeenCalledTimes(2)
    expect(mocks.removeExtension).toHaveBeenCalledTimes(1)
    expect(sess.extensions.getExtension(extensionId)).toBeDefined()
  })

  it('keeps enablement truthful and blocks reuse when native rollback fails', async () => {
    const extensionId = 'failed-active-extension'
    const profile = profileWithId('profile-failed-active')
    const installed = installedExtension(extensionId)
    const extensions = new Map<string, Electron.Extension>()
    const sess = createSession(extensions, {})
    mocks.enabledByProfile = { [profile.id]: [extensionId], 'profile-other': ['unaffected'] }
    mocks.sessions.set(profile.partition, sess)
    mocks.installs.set(extensionId, installed)
    mocks.loadInstalled.mockImplementation(async () => {
      const loaded = nativeExtension(extensionId)
      extensions.set(extensionId, loaded)
      return loaded
    })
    mocks.restore.mockRejectedValue(new Error('native content script restore failed'))
    mocks.removeExtension.mockImplementation(() => {
      throw new Error('native remove failed before unloading')
    })

    const loader =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-loader')
    const services =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-services')
    services.installBrowserExtensionSessionServices()
    loader.attachBrowserExtensionsToProfileSession(profile, [])
    await loader.whenBrowserExtensionProfileLoaded(profile.id)

    await expect(loader.loadBrowserExtensionIntoProfile(profile.id, installed)).rejects.toThrow(
      /may remain active in Chromium/
    )

    expect(mocks.enabledByProfile).toEqual({
      [profile.id]: [extensionId],
      'profile-other': ['unaffected']
    })
    expect(sess.extensions.getExtension(extensionId)).toBeDefined()
    await expect(loader.loadBrowserExtensionIntoProfile(profile.id, installed)).rejects.toThrow(
      /remain active/
    )
    expect(mocks.loadInstalled).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicit disable effective when it races a reload refresh', async () => {
    const extensionId = 'disable-reload-race-extension'
    const profile = profileWithId('profile-disable-reload')
    const installed = installedExtension(extensionId)
    const extensions = new Map<string, Electron.Extension>()
    const extensionEvents: { callback?: (event: unknown, extension: Electron.Extension) => void } =
      {}
    const sess = createSession(extensions, extensionEvents)
    mocks.enabledByProfile = { [profile.id]: [extensionId] }
    mocks.sessions.set(profile.partition, sess)
    mocks.installs.set(extensionId, installed)
    mocks.loadInstalled.mockImplementation(async () => {
      const loaded = nativeExtension(extensionId)
      extensions.set(extensionId, loaded)
      return loaded
    })
    let started!: () => void
    let prepareStarted!: () => void
    let releasePrepare!: () => void
    const startedRestore = new Promise<void>((resolve) => (started = resolve))
    const startedPreparation = new Promise<void>((resolve) => (prepareStarted = resolve))
    const prepareGate = new Promise<void>((resolve) => (releasePrepare = resolve))
    mocks.prepareDirectory.mockImplementation(async () => {
      prepareStarted()
      await prepareGate
    })
    mocks.restore.mockImplementation(async () => {
      if (mocks.restore.mock.calls.length === 1) {
        started()
        return await new Promise<never>((_resolve, reject) => {
          mocks.cancelRestore = () => reject(new Error('Extension context was unloaded'))
        })
      }
    })
    mocks.removeExtension.mockImplementation((_session: object, id: string) => {
      const removed = extensions.get(id)
      extensions.delete(id)
      if (removed) {
        extensionEvents.callback?.({}, removed)
      }
    })

    const loader =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-loader')
    const services =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-services')
    const reload =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-profile-reload')
    services.installBrowserExtensionSessionServices()
    loader.attachBrowserExtensionsToProfileSession(profile, [extensionId])

    await startedRestore
    const reloading = reload.reloadBrowserExtensionWhereEnabled(installed, {
      refresh: true
    })
    await startedPreparation
    await loader.whenBrowserExtensionProfileLoaded(profile.id)
    await loader.unloadBrowserExtensionFromProfile(profile.id, extensionId, 'user-disabled')
    mocks.enabledByProfile[profile.id] = []
    releasePrepare()
    await reloading

    expect(mocks.enabledByProfile[profile.id]).toEqual([])
    expect(mocks.loadInstalled).toHaveBeenCalledTimes(1)
    expect(mocks.restore).toHaveBeenCalledTimes(1)
    expect(mocks.removeExtension).toHaveBeenCalledTimes(1)
    expect(sess.extensions.getExtension(extensionId)).toBeUndefined()
  })

  it('clears only the failed extension after a genuine restore failure is rolled back', async () => {
    const extensionId = 'restore-failure-rollback-extension'
    const profile = profileWithId('profile-restore-rollback')
    const installed = installedExtension(extensionId)
    const extensions = new Map<string, Electron.Extension>()
    const extensionEvents: { callback?: (event: unknown, extension: Electron.Extension) => void } =
      {}
    const sess = createSession(extensions, extensionEvents)
    mocks.enabledByProfile = {
      [profile.id]: [extensionId, 'unaffected-extension'],
      'profile-other': [extensionId]
    }
    mocks.sessions.set(profile.partition, sess)
    mocks.installs.set(extensionId, installed)
    mocks.loadInstalled.mockImplementation(async () => {
      const loaded = nativeExtension(extensionId)
      extensions.set(extensionId, loaded)
      return loaded
    })
    const restoreFailure = new Error('native content script restore failed')
    mocks.restore.mockRejectedValue(restoreFailure)
    mocks.removeExtension.mockImplementation((_session: object, id: string) => {
      const removed = extensions.get(id)
      extensions.delete(id)
      if (removed) {
        extensionEvents.callback?.({}, removed)
      }
    })

    const loader =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-loader')
    const services =
      await import('../../../../../src/main/browser/extensions/profile-sessions/browser-extension-session-services')
    services.installBrowserExtensionSessionServices()
    loader.attachBrowserExtensionsToProfileSession(profile, [])
    await loader.whenBrowserExtensionProfileLoaded(profile.id)

    await expect(loader.loadBrowserExtensionIntoProfile(profile.id, installed)).rejects.toBe(
      restoreFailure
    )

    expect(sess.extensions.getExtension(extensionId)).toBeUndefined()
    expect(mocks.enabledByProfile).toEqual({
      [profile.id]: ['unaffected-extension'],
      'profile-other': [extensionId]
    })
  })
})
