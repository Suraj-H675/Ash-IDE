import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstalledBrowserExtension } from '../../../../shared/browser/extensions/browser-extension-types'
import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'

const mocks = vi.hoisted(() => ({
  sessions: new Map<string, object>(),
  extensionsBySession: new Map<object, Map<string, object>>(),
  installs: new Map<string, object>(),
  loadInstalled: vi.fn(),
  loadUnpacked: vi.fn(),
  removeExtension: vi.fn(),
  retireProfileStorage: vi.fn(async () => undefined),
  forgetProfileState: vi.fn(),
  forgetSyncProfile: vi.fn(),
  forgetDnrProfile: vi.fn(),
  recordLoadFailure: vi.fn()
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => mocks.sessions.get(partition)
  }
}))
vi.mock('../browser-extension-support', () => ({
  isBrowserExtensionSupportEnabled: () => true,
  isBrowserExtensionMutationPaused: () => false,
  pauseBrowserExtensionMutations: async () => () => {}
}))
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
  getBrowserExtensionProfileStateStore: () => ({ forgetProfile: mocks.forgetProfileState })
}))
vi.mock('../profile-storage/browser-extension-sync-storage-store', () => ({
  getBrowserExtensionSyncStorageStore: () => ({ forgetProfile: mocks.forgetSyncProfile })
}))
vi.mock('../declarative-net-request/session/browser-extension-dnr-store', () => ({
  getBrowserExtensionDnrStore: () => ({ forgetProfile: mocks.forgetDnrProfile })
}))
vi.mock('../profile-storage/browser-extension-retired-profile-storage', () => ({
  retireBrowserExtensionProfileStorage: mocks.retireProfileStorage
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
  forgetBrowserExtensionLoadFailures: vi.fn(),
  recordBrowserExtensionLoadFailure: mocks.recordLoadFailure
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
  detachBrowserExtensionsFromAllProfileSessions,
  getBrowserExtensionSessionForProfile,
  loadBrowserExtensionIntoProfile,
  unloadBrowserExtensionEverywhere,
  setBrowserExtensionSessionHooks,
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

describe('global browser extension disable recovery', () => {
  it('keeps the failed native session reachable for a second disable attempt', async () => {
    const id = 'global-disable-retry-extension'
    const p = profile('global-disable-retry-profile')
    install(p.id, id)
    const sess = mocks.sessions.get(p.partition) as Electron.Session
    attachBrowserExtensionsToProfileSession(p, [id])
    await whenBrowserExtensionProfileLoaded(p.id)
    expect(sess.extensions.getExtension(id)).toBeTruthy()
    mocks.removeExtension.mockImplementationOnce(() => {
      throw new Error('native removal refused')
    })
    await expect(detachBrowserExtensionsFromAllProfileSessions()).rejects.toThrow(
      'native removal refused'
    )
    expect(sess.extensions.getExtension(id)).toBeTruthy()
    expect(getBrowserExtensionSessionForProfile(p.id)).toBeNull()
    await detachBrowserExtensionsFromAllProfileSessions()
    expect(mocks.removeExtension).toHaveBeenCalledTimes(2)
    expect(sess.extensions.getExtension(id)).toBeUndefined()
  })

  it('blocks reattachment until failed native removal has been retried', async () => {
    const id = 'global-disable-block-reattach-extension'
    const p = profile('global-disable-block-reattach-profile')
    install(p.id, id)
    attachBrowserExtensionsToProfileSession(p, [id])
    await whenBrowserExtensionProfileLoaded(p.id)
    mocks.removeExtension.mockImplementationOnce(() => {
      throw new Error('native removal refused')
    })
    await expect(detachBrowserExtensionsFromAllProfileSessions()).rejects.toThrow(
      'native removal refused'
    )
    attachBrowserExtensionsToProfileSession(p, [id])
    await whenBrowserExtensionProfileLoaded(p.id)
    expect(getBrowserExtensionSessionForProfile(p.id)).toBeNull()
    expect(mocks.loadInstalled).toHaveBeenCalledTimes(1)
    await detachBrowserExtensionsFromAllProfileSessions()
    attachBrowserExtensionsToProfileSession(p, [id])
    await whenBrowserExtensionProfileLoaded(p.id)
    expect(mocks.loadInstalled).toHaveBeenCalledTimes(2)
    await detachBrowserExtensionsFromAllProfileSessions()
  })

  it('returns a failed retiring session to extension removal after retrying native unload', async () => {
    const id = 'global-disable-remove-after-failure-extension'
    const p = profile('global-disable-remove-after-failure-profile')
    install(p.id, id)
    const sess = mocks.sessions.get(p.partition) as Electron.Session
    attachBrowserExtensionsToProfileSession(p, [id])
    await whenBrowserExtensionProfileLoaded(p.id)
    mocks.removeExtension.mockImplementationOnce(() => {
      throw new Error('native removal refused')
    })

    await expect(detachBrowserExtensionsFromAllProfileSessions()).rejects.toThrow(
      'native removal refused'
    )
    expect(getBrowserExtensionSessionForProfile(p.id)).toBeNull()

    await expect(unloadBrowserExtensionEverywhere(id)).resolves.toEqual([sess])
    expect(mocks.removeExtension).toHaveBeenCalledTimes(2)
    expect(sess.extensions.getExtension(id)).toBeUndefined()
  })

  it('waits for all active profile unloads before releasing extension removal after a failure', async () => {
    const id = 'global-disable-wait-all-removal-extension'
    const a = profile('global-disable-wait-all-failure')
    const b = profile('global-disable-wait-all-pending')
    install(a.id, id)
    install(b.id, id)
    attachBrowserExtensionsToProfileSession(a, [id])
    attachBrowserExtensionsToProfileSession(b, [])
    await Promise.all([
      whenBrowserExtensionProfileLoaded(a.id),
      whenBrowserExtensionProfileLoaded(b.id)
    ])

    let release!: () => void
    let loadStarted!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      loadStarted = resolve
    })
    const bSession = mocks.sessions.get(b.partition)
    const normalLoad = mocks.loadInstalled.getMockImplementation()!
    mocks.loadInstalled.mockImplementationOnce(async (...args: Parameters<typeof normalLoad>) => {
      if (args[0] === bSession) {
        loadStarted()
        await gate
      }
      return normalLoad(...args)
    })
    const pendingLoad = loadBrowserExtensionIntoProfile(
      b.id,
      mocks.installs.get(id) as InstalledBrowserExtension
    )
    await started

    let failed!: () => void
    const firstFailure = new Promise<void>((resolve) => {
      failed = resolve
    })
    const normalRemove = mocks.removeExtension.getMockImplementation()!
    const aSession = mocks.sessions.get(a.partition)
    mocks.removeExtension.mockImplementation((sess: Electron.Session, extensionId: string) => {
      if (sess === aSession) {
        failed()
        throw new Error('first profile removal failed')
      }
      return normalRemove(sess, extensionId)
    })

    let settled = false
    const result = unloadBrowserExtensionEverywhere(id).finally(() => {
      settled = true
    })
    await firstFailure
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)

    release()
    await expect(result).rejects.toThrow('first profile removal failed')
    await expect(pendingLoad).rejects.toThrow()
    expect(settled).toBe(true)
  })

  it('waits for all profile unloads to settle despite another profile failing', async () => {
    const a = profile('global-disable-fast-failure')
    const b = profile('global-disable-pending-load')
    install(a.id, 'fast-failure-extension')
    install(b.id, 'pending-load-extension')
    const aSession = mocks.sessions.get(a.partition)
    attachBrowserExtensionsToProfileSession(a, ['fast-failure-extension'])
    await whenBrowserExtensionProfileLoaded(a.id)
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const normalLoad = mocks.loadInstalled.getMockImplementation()!
    mocks.loadInstalled.mockImplementationOnce(async (...args: Parameters<typeof normalLoad>) => {
      entered()
      await gate
      return normalLoad(...args)
    })
    attachBrowserExtensionsToProfileSession(b, ['pending-load-extension'])
    await started
    let failedRemoval!: () => void
    const removed = new Promise<void>((resolve) => {
      failedRemoval = resolve
    })
    const normalRemove = mocks.removeExtension.getMockImplementation()!
    mocks.removeExtension.mockImplementation((sess: Electron.Session, id: string) => {
      if (sess === aSession) {
        failedRemoval()
        throw new Error('first profile removal failed')
      }
      return normalRemove(sess, id)
    })
    let settled = false
    const result = detachBrowserExtensionsFromAllProfileSessions().then(
      () => {
        settled = true
        return null
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    await removed
    await new Promise<void>((resolve) => setImmediate(resolve))
    const prematurelySettled = settled
    release()
    expect(await result).toBeInstanceOf(Error)
    expect(prematurelySettled).toBe(false)
    mocks.removeExtension.mockImplementation(normalRemove)
    await detachBrowserExtensionsFromAllProfileSessions()
  })
})
