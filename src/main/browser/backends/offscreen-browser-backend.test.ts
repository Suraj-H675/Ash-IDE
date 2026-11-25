import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  class FakeWebContents {
    readonly id: number
    readonly handlers = new Map<string, Set<Listener>>()
    readonly debugger = { isAttached: () => false, detach: vi.fn() }
    destroyed = false
    url = 'about:blank'
    loadedUrls: string[] = []

    constructor(id: number) {
      this.id = id
    }

    on(event: string, listener: Listener): this {
      const listeners = this.handlers.get(event) ?? new Set<Listener>()
      listeners.add(listener)
      this.handlers.set(event, listeners)
      return this
    }

    once(event: string, listener: Listener): this {
      const onceListener: Listener = (...args) => {
        this.removeListener(event, onceListener)
        listener(...args)
      }
      return this.on(event, onceListener)
    }

    removeListener(event: string, listener: Listener): this {
      this.handlers.get(event)?.delete(listener)
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.handlers.get(event) ?? []) {
        listener(...args)
      }
    }

    loadURL(url: string): Promise<void> {
      this.url = url
      this.loadedUrls.push(url)
      this.emit('did-finish-load')
      return Promise.resolve()
    }

    getURL(): string {
      return this.url
    }

    getTitle(): string {
      return 'Test page'
    }

    isDestroyed(): boolean {
      return this.destroyed
    }
  }

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    static failNextCreation = false
    readonly webContents: FakeWebContents
    readonly options: Record<string, unknown>
    destroyed = false

    constructor(options: Record<string, unknown>) {
      if (FakeBrowserWindow.failNextCreation) {
        FakeBrowserWindow.failNextCreation = false
        throw new Error('display connection unavailable')
      }
      this.options = options
      this.webContents = new FakeWebContents(1000 + FakeBrowserWindow.instances.length)
      FakeBrowserWindow.instances.push(this)
    }

    destroy(): void {
      if (this.destroyed) {
        return
      }
      this.destroyed = true
      this.webContents.destroyed = true
      this.webContents.emit('destroyed')
    }

    isDestroyed(): boolean {
      return this.destroyed
    }
  }

  const owners = new Map<string, number>()
  const replacementListeners = new Set<
    (event: {
      browserPageId: string
      previousWebContentsId: number
      nextWebContentsId: number
    }) => void
  >()
  const bridge = {
    onPageClosed: vi.fn(async () => {}),
    onProcessSwap: vi.fn(async () => {})
  }
  const manager = {
    registerOffscreenGuest: vi.fn((args: { browserPageId: string; webContentsId: number }) => {
      if (owners.has(args.browserPageId)) {
        return false
      }
      owners.set(args.browserPageId, args.webContentsId)
      return true
    }),
    unregisterGuest: vi.fn((pageId: string, _reason?: string, expectedWebContentsId?: number) => {
      if (owners.get(pageId) === expectedWebContentsId) {
        owners.delete(pageId)
      }
    }),
    getGuestWebContentsId: vi.fn((pageId: string) => owners.get(pageId) ?? null),
    onOffscreenGuestOwnerReplaced: vi.fn(
      (
        listener: (event: {
          browserPageId: string
          previousWebContentsId: number
          nextWebContentsId: number
        }) => void
      ) => {
        replacementListeners.add(listener)
        return () => replacementListeners.delete(listener)
      }
    )
  }
  const defaultProfile = { id: 'default', partition: 'persist:default' }
  const alphaProfile = { id: 'alpha', partition: 'persist:alpha' }
  const browserSessionRegistry = {
    getDefaultProfile: vi.fn(() => defaultProfile),
    getProfile: vi.fn((id: string) => (id === alphaProfile.id ? alphaProfile : null))
  }

  return {
    FakeBrowserWindow,
    owners,
    replacementListeners,
    manager,
    bridge,
    browserSessionRegistry,
    defaultProfile,
    alphaProfile,
    installDialogs: vi.fn()
  }
})

vi.mock('electron', () => ({ BrowserWindow: mocks.FakeBrowserWindow }))
vi.mock('../sessions/browser-session-registry', () => ({
  browserSessionRegistry: mocks.browserSessionRegistry
}))
vi.mock('../guest-lifecycle/prompts/browser-javascript-dialogs', () => ({
  installBrowserJavaScriptDialogs: mocks.installDialogs
}))

import { OffscreenBrowserBackend } from './offscreen-browser-backend'

describe('OffscreenBrowserBackend', () => {
  beforeEach(() => {
    mocks.FakeBrowserWindow.instances = []
    mocks.FakeBrowserWindow.failNextCreation = false
    mocks.owners.clear()
    mocks.replacementListeners.clear()
    mocks.manager.registerOffscreenGuest.mockClear()
    mocks.manager.unregisterGuest.mockClear()
    mocks.manager.getGuestWebContentsId.mockClear()
    mocks.manager.onOffscreenGuestOwnerReplaced.mockClear()
    mocks.bridge.onPageClosed.mockClear()
    mocks.bridge.onProcessSwap.mockClear()
    mocks.browserSessionRegistry.getDefaultProfile.mockClear()
    mocks.browserSessionRegistry.getProfile.mockClear()
    mocks.installDialogs.mockClear()
  })

  it('rejects an unknown explicit profile before creating an isolated page', async () => {
    const backend = new OffscreenBrowserBackend(mocks.manager as never)

    await expect(
      backend.createTab({ url: 'https://example.test', profileId: 'missing' })
    ).rejects.toMatchObject({ code: 'invalid_argument' })

    expect(mocks.FakeBrowserWindow.instances).toHaveLength(0)
    expect(mocks.manager.registerOffscreenGuest).not.toHaveBeenCalled()
  })

  it('reports native window creation failure as unavailable browser capability', async () => {
    mocks.FakeBrowserWindow.failNextCreation = true
    const backend = new OffscreenBrowserBackend(mocks.manager as never)

    await expect(backend.createTab({ url: 'https://example.test' })).rejects.toMatchObject({
      code: 'browser_error',
      message: 'Offscreen browser is unavailable: display connection unavailable'
    })
    expect(mocks.manager.registerOffscreenGuest).not.toHaveBeenCalled()
  })

  it('reuses the exact profile partition and stable page id when a closed page is reopened', async () => {
    const backend = new OffscreenBrowserBackend(mocks.manager as never)
    const page = { browserPageId: 'page-1', url: 'https://example.test/saved' }

    await backend.createTab({ ...page, profileId: 'alpha' })
    const firstWindow = mocks.FakeBrowserWindow.instances[0]
    await backend.closeTab(page.browserPageId)
    await backend.createTab({ ...page, profileId: 'alpha' })
    const reopenedWindow = mocks.FakeBrowserWindow.instances[1]

    expect((firstWindow.options.webPreferences as { partition: string }).partition).toBe(
      'persist:alpha'
    )
    expect((reopenedWindow.options.webPreferences as { partition: string }).partition).toBe(
      'persist:alpha'
    )
    expect(firstWindow.webContents.loadedUrls).toEqual([page.url])
    expect(reopenedWindow.webContents.loadedUrls).toEqual([page.url])
    expect(mocks.manager.registerOffscreenGuest.mock.calls.map(([call]) => call)).toEqual([
      expect.objectContaining({ browserPageId: page.browserPageId }),
      expect.objectContaining({ browserPageId: page.browserPageId })
    ])
  })

  it('retires only the replaced offscreen owner and ignores its later navigation events', async () => {
    const onPageNavigated = vi.fn()
    const backend = new OffscreenBrowserBackend(mocks.manager as never, {
      getAgentBrowserBridge: () => mocks.bridge as never,
      onPageNavigated
    })
    const pageId = 'page-transfer'
    await backend.createTab({
      browserPageId: pageId,
      url: 'https://example.test/before',
      worktreeId: 'repo::/worktree'
    })
    const hiddenWindow = mocks.FakeBrowserWindow.instances[0]
    const oldWebContentsId = hiddenWindow.webContents.id
    const nextWebContentsId = oldWebContentsId + 100

    mocks.owners.set(pageId, nextWebContentsId)
    for (const listener of mocks.replacementListeners) {
      listener({
        browserPageId: pageId,
        previousWebContentsId: oldWebContentsId,
        nextWebContentsId
      })
    }
    hiddenWindow.webContents.emit('did-stop-loading')
    await backend.closeTab(pageId)

    expect(hiddenWindow.isDestroyed()).toBe(true)
    expect(backend.ownsTab(pageId)).toBe(false)
    expect(mocks.manager.getGuestWebContentsId(pageId)).toBe(nextWebContentsId)
    expect(mocks.manager.unregisterGuest).toHaveBeenCalledWith(
      pageId,
      'guest-destroyed',
      oldWebContentsId
    )
    expect(mocks.bridge.onProcessSwap).toHaveBeenCalledWith(
      pageId,
      nextWebContentsId,
      oldWebContentsId
    )
    expect(mocks.bridge.onPageClosed).not.toHaveBeenCalled()
    expect(onPageNavigated).not.toHaveBeenCalled()
  })

  it('closes only owned guests of a removed worktree, even when a bridge row is absent', async () => {
    const backend = new OffscreenBrowserBackend(mocks.manager as never, {
      getAgentBrowserBridge: () => mocks.bridge as never
    })
    await backend.createTab({
      browserPageId: 'removed-page',
      worktreeId: 'removed',
      url: 'about:blank'
    })
    await backend.createTab({
      browserPageId: 'other-page',
      worktreeId: 'other',
      url: 'about:blank'
    })
    const [removed, other] = mocks.FakeBrowserWindow.instances
    mocks.owners.delete('removed-page')
    await backend.closeWorktreeTabs('removed')
    expect(removed.isDestroyed()).toBe(true)
    expect(backend.ownsTab('removed-page')).toBe(false)
    expect(other.isDestroyed()).toBe(false)
    expect(backend.ownsTab('other-page')).toBe(true)
    expect(mocks.bridge.onPageClosed).toHaveBeenCalledWith('removed-page', removed.webContents.id)
  })

  it('coalesces duplicate closes before allowing the same page id to reopen', async () => {
    let releaseRetirement: (() => void) | undefined
    mocks.bridge.onPageClosed.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseRetirement = resolve))
    )
    const backend = new OffscreenBrowserBackend(mocks.manager as never, {
      getAgentBrowserBridge: () => mocks.bridge as never
    })
    await backend.createTab({ browserPageId: 'page-close-race', url: 'about:blank' })

    const firstClose = backend.closeTab('page-close-race')
    const duplicateClose = backend.closeTab('page-close-race')
    expect(mocks.bridge.onPageClosed).toHaveBeenCalledTimes(1)
    expect(mocks.FakeBrowserWindow.instances[0].isDestroyed()).toBe(true)

    const reopen = backend.createTab({ browserPageId: 'page-close-race', url: 'about:blank' })
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1)
    releaseRetirement?.()
    await Promise.all([firstClose, duplicateClose, reopen])
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(2)
    expect(backend.ownsTab('page-close-race')).toBe(true)
  })
})
