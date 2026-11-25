import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { ORCA_BROWSER_GUEST_WEB_PREFERENCES } from '../../../shared/browser-guest-web-preferences'
import { mapSettledWithConcurrency } from '../../../shared/map-with-concurrency'
import type { BrowserBackend, BrowserBackendCreateTab } from '../browser-backend'
import type { BrowserManager } from '../browser-manager'
import type { AgentBrowserBridge } from '../agent-browser/agent-browser-bridge'
import { BrowserError } from '../browser-error'
import { browserSessionRegistry } from '../sessions/browser-session-registry'
import { installBrowserJavaScriptDialogs } from '../guest-lifecycle/prompts/browser-javascript-dialogs'
import {
  endOffscreenBrowserDebuggerSessions,
  loadOffscreenBrowserUrl
} from './offscreen-browser-page-load'
import type { ServeBrowserPageState } from '../../runtime/serve-browser-tab-layout'

// orca serve has no renderer for webviews; hidden BrowserWindows host its pages.
// Headless Linux requires Xvfb; Electron --headless segfaults.

const DEFAULT_VIEWPORT_WIDTH = 1280
const DEFAULT_VIEWPORT_HEIGHT = 800
const OWNER_RETIREMENT_CONCURRENCY = 4

type OffscreenPageOwner = {
  window: BrowserWindow
  webContentsId: number
  worktreeId?: string
}

export class OffscreenBrowserBackend implements BrowserBackend {
  private readonly ownersByPageId = new Map<string, OffscreenPageOwner>()
  private readonly pendingCloseByPageId = new Map<string, Promise<void>>()
  // Reject creates once shutdown starts so pages cannot escape destroyAll's ownership snapshot.
  private shutdownStarted = false
  private readonly pendingOwnerRetirements = new Set<Promise<void>>()

  constructor(
    private readonly browserManager: BrowserManager,
    private readonly options: {
      getAgentBrowserBridge?: () => Pick<
        AgentBrowserBridge,
        'onPageClosed' | 'onProcessSwap'
      > | null
      onPageNavigated?: (page: ServeBrowserPageState) => void
    } = {}
  ) {
    this.unsubscribeOwnerReplacement = browserManager.onOffscreenGuestOwnerReplaced((replacement) =>
      this.onOwnerReplaced(replacement)
    )
  }

  private readonly unsubscribeOwnerReplacement: () => void

  async createTab(params: BrowserBackendCreateTab): Promise<{ browserPageId: string }> {
    if (this.shutdownStarted) {
      throw new Error('Offscreen browser backend is shutting down')
    }
    const browserPageId = params.browserPageId ?? randomUUID()
    const pendingClose = this.pendingCloseByPageId.get(browserPageId)
    if (pendingClose) {
      await pendingClose
    }
    if (this.shutdownStarted) {
      throw new Error('Offscreen browser backend is shutting down')
    }
    if (this.ownersByPageId.has(browserPageId)) {
      throw new BrowserError('browser_tab_exists', `Browser page ${browserPageId} already exists`)
    }
    // Reuse desktop profile partitions to preserve cookies and storage.
    const profile =
      params.profileId === undefined
        ? browserSessionRegistry.getDefaultProfile()
        : browserSessionRegistry.getProfile(params.profileId)
    if (!profile) {
      throw new BrowserError(
        'invalid_argument',
        `Browser profile ${params.profileId} was not found`
      )
    }

    let win: BrowserWindow
    try {
      win = new BrowserWindow({
        show: false,
        width: DEFAULT_VIEWPORT_WIDTH,
        height: DEFAULT_VIEWPORT_HEIGHT,
        webPreferences: {
          ...ORCA_BROWSER_GUEST_WEB_PREFERENCES,
          partition: profile.partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      throw new BrowserError('browser_error', `Offscreen browser is unavailable: ${cause}`)
    }

    // Server pages have no window to ask in; agents and phones answer their dialogs.
    installBrowserJavaScriptDialogs(win.webContents, () => null)

    // Do not wait for navigation: slow or failed loads must leave an operable tab.
    const registered = this.browserManager.registerOffscreenGuest({
      browserPageId,
      worktreeId: params.worktreeId,
      sessionProfileId: profile.id,
      webContentsId: win.webContents.id
    })
    if (!registered) {
      // Registration installs guest policies; destroy refused windows before any navigation.
      win.destroy()
      throw new BrowserError(
        'browser_tab_exists',
        `Browser page ${browserPageId} already has an owner`
      )
    }

    const owner = { window: win, webContentsId: win.webContents.id, worktreeId: params.worktreeId }
    this.ownersByPageId.set(browserPageId, owner)

    // Install teardown only after registration; a refused id may belong to a document preview.
    win.webContents.once('destroyed', () => {
      // A stale owner cannot unregister or retire the replacement page.
      if (this.ownersByPageId.get(browserPageId) !== owner) {
        return
      }
      void this.closeOwner(browserPageId, owner, 'guest-destroyed')
    })

    const { worktreeId } = params
    const { onPageNavigated } = this.options
    if (worktreeId && onPageNavigated) {
      const report = (): void => {
        if (!this.isCurrentOwner(browserPageId, owner)) {
          return
        }
        onPageNavigated({
          worktreeId,
          pageId: browserPageId,
          url: win.webContents.getURL(),
          title: win.webContents.getTitle()
        })
      }
      // Persist at navigation milestones, avoiding writes for every dynamic title update.
      win.webContents.on('did-navigate-in-page', report)
      win.webContents.on('did-stop-loading', report)
    }

    const url = params.url || 'about:blank'
    const initialLoad = loadOffscreenBrowserUrl(win, url).catch((error) => {
      console.warn(
        '[offscreen-browser] page load failed:',
        error instanceof Error ? error.message : String(error)
      )
    })
    if (params.waitForInitialLoad) {
      await initialLoad
    }

    return { browserPageId }
  }

  async closeTab(browserPageId: string): Promise<void> {
    const owner = this.ownersByPageId.get(browserPageId)
    if (!owner) {
      await this.pendingCloseByPageId.get(browserPageId)
      return
    }
    await this.closeOwner(browserPageId, owner, 'page-closed')
  }

  async closeWorktreeTabs(worktreeId: string): Promise<void> {
    // Snapshot exact owner incarnations, not the bridge's potentially incomplete tab list.
    const owners = [...this.ownersByPageId].filter(([, owner]) => owner.worktreeId === worktreeId)
    // Start each owner retirement synchronously before the caller removes its managed profile.
    await Promise.allSettled(
      owners.map(([pageId, owner]) => this.closeOwner(pageId, owner, 'page-closed'))
    )
  }

  ownsTab(browserPageId: string): boolean {
    return this.ownersByPageId.has(browserPageId)
  }

  getWebContentsId(browserPageId: string): number | null {
    const owner = this.ownersByPageId.get(browserPageId)
    return owner && !owner.window.isDestroyed() ? owner.webContentsId : null
  }

  async destroyAll(): Promise<void> {
    this.shutdownStarted = true
    const pageIds = [...this.ownersByPageId.keys()]
    await mapSettledWithConcurrency(pageIds, OWNER_RETIREMENT_CONCURRENCY, (pageId) =>
      this.closeTab(pageId)
    )
    await Promise.all(this.pendingOwnerRetirements)
    await Promise.all(this.pendingCloseByPageId.values())
    this.unsubscribeOwnerReplacement()
  }

  private isCurrentOwner(browserPageId: string, owner: OffscreenPageOwner): boolean {
    return (
      this.ownersByPageId.get(browserPageId) === owner &&
      this.browserManager.getGuestWebContentsId(browserPageId) === owner.webContentsId
    )
  }

  private onOwnerReplaced(replacement: {
    browserPageId: string
    previousWebContentsId: number
    nextWebContentsId: number
  }): void {
    const owner = this.ownersByPageId.get(replacement.browserPageId)
    if (!owner || owner.webContentsId !== replacement.previousWebContentsId) {
      return
    }
    this.ownersByPageId.delete(replacement.browserPageId)
    const bridge = this.options.getAgentBrowserBridge?.()
    const bridgeRetirement = bridge
      ? bridge
          .onProcessSwap(
            replacement.browserPageId,
            replacement.nextWebContentsId,
            replacement.previousWebContentsId
          )
          .catch(() => {})
      : Promise.resolve()
    this.trackRetirement(bridgeRetirement)
    // The manager now belongs to the replacement renderer, so unregister is deliberately scoped.
    this.browserManager.unregisterGuest(
      replacement.browserPageId,
      'guest-destroyed',
      replacement.previousWebContentsId
    )
    const replacementRetirement = Promise.all([this.destroyOwner(owner), bridgeRetirement]).then(
      () => {}
    )
    this.pendingCloseByPageId.set(replacement.browserPageId, replacementRetirement)
    void replacementRetirement.finally(() => {
      if (this.pendingCloseByPageId.get(replacement.browserPageId) === replacementRetirement) {
        this.pendingCloseByPageId.delete(replacement.browserPageId)
      }
    })
  }

  private async closeOwner(
    browserPageId: string,
    owner: OffscreenPageOwner,
    reason: 'page-closed' | 'guest-destroyed'
  ): Promise<void> {
    if (this.ownersByPageId.get(browserPageId) !== owner) {
      await this.pendingCloseByPageId.get(browserPageId)
      return
    }
    this.ownersByPageId.delete(browserPageId)
    const currentWebContentsId = this.browserManager.getGuestWebContentsId(browserPageId)
    if (currentWebContentsId === owner.webContentsId) {
      this.browserManager.unregisterGuest(browserPageId, reason, owner.webContentsId)
    }
    const retirement = this.retirePageOwner(browserPageId, owner.webContentsId)
    const closing = Promise.all([retirement, this.destroyOwner(owner)]).then(() => {})
    this.pendingCloseByPageId.set(browserPageId, closing)
    try {
      await closing
    } finally {
      if (this.pendingCloseByPageId.get(browserPageId) === closing) {
        this.pendingCloseByPageId.delete(browserPageId)
      }
    }
  }

  private destroyOwner(owner: OffscreenPageOwner): Promise<void> {
    const destroy = async (): Promise<void> => {
      if (owner.window.isDestroyed()) {
        return
      }
      endOffscreenBrowserDebuggerSessions(owner.window)
      owner.window.destroy()
    }
    return destroy()
  }

  private retirePageOwner(browserPageId: string, webContentsId: number): Promise<void> {
    const bridge = this.options.getAgentBrowserBridge?.()
    if (!bridge) {
      return Promise.resolve()
    }
    const retirement = bridge.onPageClosed(browserPageId, webContentsId).catch(() => {})
    this.trackRetirement(retirement)
    return retirement
  }

  private trackRetirement(retirement: Promise<void>): void {
    this.pendingOwnerRetirements.add(retirement)
    void retirement.finally(() => this.pendingOwnerRetirements.delete(retirement))
  }
}
