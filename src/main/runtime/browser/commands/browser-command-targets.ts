import type { BrowserSnapshotOptions } from '../../../../shared/rpc-contract/browser-observation-params'
import type { AgentBrowserBridge } from '../../../browser/agent-browser/agent-browser-bridge'
import { BrowserError } from '../../../browser/browser-error'
import { browserPopupPageWebContentsId } from '../../../browser/guest-lifecycle/popups/browser-popup-page-id'
import { webContents } from 'electron'
import {
  waitForTabFirstLoad,
  waitForNextTabRegistration,
  waitForTabRegistration,
  waitForWorktreeTabRegistration
} from '../../../ipc/browser/browser-tab-registration-wait'
import { whenBrowserMainWindowReady } from '../../../browser/guest-lifecycle/browser-main-window-readiness'
import type { BrowserSnapshotResult } from '../../../../shared/runtime-browser-contracts'
import type {
  BrowserCommandTargetParams,
  RuntimeBrowserCommandHost,
  ResolvedBrowserCommandTarget,
  ResolvedBrowserPageWebContents
} from './browser-command-contracts'

const MAIN_WINDOW_READY_WAIT_MS = 8_000

export class RuntimeBrowserCommandTargets {
  constructor(
    private readonly host: Pick<
      RuntimeBrowserCommandHost,
      | 'getAgentBrowserBridge'
      | 'resolveWorkspaceSelector'
      | 'getAuthoritativeWindow'
      | 'getAvailableAuthoritativeWindow'
      | 'getInstalledOffscreenBrowserBackend'
      | 'retireRuntimeOwnedBrowserSessionTab'
      | 'serveBrowserTabs'
    >
  ) {}

  requireAgentBrowserBridge(): AgentBrowserBridge {
    const bridge = this.host.getAgentBrowserBridge()
    if (!bridge) {
      throw new BrowserError('browser_no_tab', 'No browser session is active')
    }
    return bridge
  }

  retireGhostBrowserSessionRow(worktreeId: string | undefined, browserPageId: string): boolean {
    return (
      worktreeId !== undefined &&
      this.host.retireRuntimeOwnedBrowserSessionTab?.(worktreeId, browserPageId) === true
    )
  }

  private hasLiveRegisteredBrowserTab(
    bridge: AgentBrowserBridge,
    worktreeId: string | undefined
  ): boolean {
    for (const [browserPageId, webContentsId] of bridge.getRegisteredTabs(worktreeId)) {
      const guest = webContents.fromId(webContentsId)
      if (
        guest &&
        !guest.isDestroyed() &&
        !this.isHiddenOffscreenOwner(browserPageId, webContentsId)
      ) {
        return true
      }
    }
    return false
  }

  private hasLiveRegisteredBrowserPage(
    bridge: AgentBrowserBridge,
    worktreeId: string | undefined,
    browserPageId: string
  ): boolean {
    const webContentsId = bridge.getRegisteredTabs(worktreeId).get(browserPageId)
    if (webContentsId == null) {
      return false
    }
    const guest = webContents.fromId(webContentsId)
    return Boolean(
      guest && !guest.isDestroyed() && !this.isHiddenOffscreenOwner(browserPageId, webContentsId)
    )
  }

  private isHiddenOffscreenOwner(browserPageId: string, webContentsId: number): boolean {
    return Boolean(
      this.host.getAvailableAuthoritativeWindow() &&
      this.host.getInstalledOffscreenBrowserBackend()?.getWebContentsId?.(browserPageId) ===
        webContentsId
    )
  }

  // Resolve CLI selectors to the repoId::path keys the bridge uses.
  async resolveBrowserWorktreeId(selector?: string): Promise<string | undefined> {
    if (!selector) {
      // Persisted webviews register only after mounting; wake them before use.
      const bridge = this.host.getAgentBrowserBridge()
      const activePageId = bridge?.getActivePageId(undefined) ?? undefined
      const activePageIsHidden =
        activePageId !== undefined &&
        bridge != null &&
        this.isHiddenOffscreenOwner(
          activePageId,
          bridge.getRegisteredTabs(undefined).get(activePageId) ?? -1
        )
      if (bridge && (activePageIsHidden || !this.hasLiveRegisteredBrowserTab(bridge, undefined))) {
        await this.ensureBrowserWorktreeActive(undefined)
      }
      return undefined
    }

    const worktreeId = (await this.host.resolveWorkspaceSelector(selector)).id
    // Explicit selector failures must surface instead of widening scope; activation alone is best-effort.
    const bridge = this.host.getAgentBrowserBridge()
    const activePageId = bridge?.getActivePageId(worktreeId) ?? undefined
    const activePageWebContentsId = activePageId
      ? bridge?.getRegisteredTabs(worktreeId).get(activePageId)
      : undefined
    const activePageIsHidden =
      activePageId !== undefined &&
      activePageWebContentsId !== undefined &&
      this.isHiddenOffscreenOwner(activePageId, activePageWebContentsId)
    if (bridge && (activePageIsHidden || !this.hasLiveRegisteredBrowserTab(bridge, worktreeId))) {
      await this.ensureBrowserWorktreeActive(worktreeId)
    }
    return worktreeId
  }

  async resolveBrowserCommandTarget(
    params: BrowserCommandTargetParams
  ): Promise<ResolvedBrowserCommandTarget> {
    const browserPageId =
      typeof params.page === 'string' && params.page.length > 0 ? params.page : undefined
    if (!browserPageId) {
      return {
        worktreeId: await this.resolveBrowserWorktreeId(params.worktree)
      }
    }

    const worktreeId = params.worktree
      ? (await this.host.resolveWorkspaceSelector(params.worktree)).id
      : undefined
    const bridge = this.host.getAgentBrowserBridge()
    // The renderer never registers popups, so waking it for a closed one only stalls.
    if (
      bridge &&
      browserPopupPageWebContentsId(browserPageId) === null &&
      !this.hasLiveRegisteredBrowserPage(bridge, worktreeId, browserPageId)
    ) {
      await this.ensureBrowserPageActive(worktreeId, browserPageId)
    }
    return {
      // Explicit page ids already provide stable scope; do not add cwd-derived worktree scope.
      worktreeId,
      browserPageId
    }
  }

  resolveBrowserPageWebContents(
    worktreeId: string | undefined,
    browserPageId: string | undefined
  ): ResolvedBrowserPageWebContents {
    const bridge = this.requireAgentBrowserBridge()
    const resolvedPageId = browserPageId ?? bridge.getActivePageId(worktreeId)
    if (!resolvedPageId) {
      throw new BrowserError('browser_no_tab', 'No browser tab open in this worktree')
    }
    const webContentsId = bridge.getRegisteredTabs(worktreeId).get(resolvedPageId)
    if (webContentsId == null) {
      const scope = worktreeId ? ' in this worktree' : ''
      throw new BrowserError(
        'browser_tab_not_found',
        `Browser page ${resolvedPageId} was not found${scope}`
      )
    }
    if (this.isHiddenOffscreenOwner(resolvedPageId, webContentsId)) {
      throw new BrowserError(
        'browser_error',
        `Browser page ${resolvedPageId} has not transferred to the desktop window yet`
      )
    }
    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      throw new BrowserError(
        'browser_tab_not_found',
        `Browser page ${resolvedPageId} is no longer available`
      )
    }
    return { browserPageId: resolvedPageId, webContents: guest }
  }

  // Mount under a hidden visibility lease so automation cannot steal the visible pane.
  private async ensureBrowserWorktreeActive(worktreeId: string | undefined): Promise<void> {
    if (this.host.getAvailableAuthoritativeWindow()) {
      const bridge = this.host.getAgentBrowserBridge()
      const backend = this.host.getInstalledOffscreenBrowserBackend()
      const activePageId = bridge?.getActivePageId(worktreeId) ?? undefined
      const activePageWebContentsId = activePageId
        ? bridge?.getRegisteredTabs(worktreeId).get(activePageId)
        : undefined
      const pageId =
        activePageId &&
        activePageWebContentsId !== undefined &&
        backend?.getWebContentsId?.(activePageId) === activePageWebContentsId
          ? activePageId
          : [...(bridge?.getRegisteredTabs(worktreeId).keys() ?? [])].find((candidate) =>
              backend?.ownsTab(candidate)
            )
      if (pageId) {
        await this.ensureBrowserPageActive(worktreeId, pageId)
        return
      }
    }
    if (await this.host.serveBrowserTabs?.start(worktreeId, undefined)) {
      return
    }
    // With no saved tab the window mounts nothing, so the wait could only time out (#20434).
    if (!this.host.serveBrowserTabs?.hasStartable(worktreeId)) {
      return
    }
    if (!this.host.getAvailableAuthoritativeWindow()) {
      throw new BrowserError('browser_error', 'This host does not support browser panes.')
    }
    await this.sendActivateView(worktreeId ? { worktreeId } : {})
    // Await registerGuest rather than guessing a fixed mount delay.
    await waitForWorktreeTabRegistration(worktreeId)
  }

  async ensureBrowserPageActive(
    worktreeId: string | undefined,
    browserPageId: string,
    options: { waitForFirstLoad?: boolean } = {}
  ): Promise<void> {
    const bridge = this.host.getAgentBrowserBridge()
    const priorWebContentsId = bridge?.getRegisteredTabs(worktreeId).get(browserPageId)
    const transfersOffscreenOwner =
      priorWebContentsId !== undefined &&
      this.isHiddenOffscreenOwner(browserPageId, priorWebContentsId)
    if (!(await this.host.serveBrowserTabs?.start(worktreeId, browserPageId))) {
      if (!this.host.getAvailableAuthoritativeWindow()) {
        if (this.host.serveBrowserTabs?.hasSavedPage(worktreeId, browserPageId)) {
          throw new BrowserError('browser_error', 'This host does not support browser panes.')
        }
        return
      }
      const registration = transfersOffscreenOwner
        ? waitForNextTabRegistration(browserPageId, MAIN_WINDOW_READY_WAIT_MS)
        : waitForTabRegistration(browserPageId)
      await this.sendActivateView(worktreeId ? { worktreeId, browserPageId } : { browserPageId })
      await registration
      if (
        transfersOffscreenOwner &&
        priorWebContentsId !== undefined &&
        this.isHiddenOffscreenOwner(browserPageId, priorWebContentsId)
      ) {
        throw new BrowserError(
          'browser_error',
          `Browser page ${browserPageId} did not transfer to the desktop window`
        )
      }
    }
    // Why opt-in: a switched-to tab should read like one open all along, but streaming panes must not wait.
    if (options.waitForFirstLoad) {
      await waitForTabFirstLoad(browserPageId)
    }
  }

  // A reloaded renderer drops activateView until it has restored the tab to mount.
  private async sendActivateView(payload: {
    worktreeId?: string
    browserPageId?: string
  }): Promise<void> {
    const win = this.host.getAvailableAuthoritativeWindow()
    if (!win) {
      throw new BrowserError('browser_error', 'No desktop browser window is available.')
    }
    await whenBrowserMainWindowReady(MAIN_WINDOW_READY_WAIT_MS)
    win.webContents.send('browser:activateView', payload)
  }

  // Automation may bypass Electron navigation events; publish authoritative URL/title updates.
  notifyRendererNavigation(browserPageId: string, url: string, title: string): void {
    try {
      const win = this.host.getAuthoritativeWindow()
      win.webContents.send('browser:navigation-update', { browserPageId, url, title })
    } catch {}
  }

  // Scope --focus to its worktree so parallel agents cannot move each other's view.
  notifyRendererBrowserPaneFocus(worktreeId: string | undefined, browserPageId: string): void {
    try {
      const win = this.host.getAuthoritativeWindow()
      win.webContents.send('browser:pane-focus', {
        worktreeId: worktreeId ?? null,
        browserPageId
      })
    } catch {}
  }

  async browserSnapshot(
    params: BrowserSnapshotOptions & BrowserCommandTargetParams
  ): Promise<BrowserSnapshotResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().snapshot(
      target.worktreeId,
      target.browserPageId,
      params
    )
  }
}
