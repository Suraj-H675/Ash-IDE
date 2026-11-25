import { BrowserError } from '../browser-error'
import { ORCA_TAB_SESSION_PREFIX } from './agent-browser-orphan-sweep'
import { AgentBrowserBridgeSessionCreation } from './agent-browser-bridge-session-creation'
import type { AgentBrowserCleanupOptions } from './agent-browser-bridge-types'
import { AGENT_BROWSER_CLEANUP_TIMEOUT_MS } from './agent-browser-bridge-types'
import { waitForAgentBrowserSessionExit } from './agent-browser-session-reset'

export abstract class AgentBrowserBridgeLifecycle extends AgentBrowserBridgeSessionCreation {
  async onTabClosed(webContentsId: number): Promise<void> {
    const browserPageId = this.resolveTabIdSafe(webContentsId)
    const owningWorktreeId = browserPageId
      ? this.browserManager.getWorktreeIdForTab(browserPageId)
      : undefined
    let nextWorktreeActiveWebContentsId: number | null = null
    if (
      owningWorktreeId &&
      this.activeWebContentsPerWorktree.get(owningWorktreeId) === webContentsId
    ) {
      nextWorktreeActiveWebContentsId = this.selectFallbackActiveWebContents(
        owningWorktreeId,
        webContentsId
      )
    }
    if (this.activeWebContentsId === webContentsId) {
      this.activeWebContentsId = nextWorktreeActiveWebContentsId
    }
    if (browserPageId) {
      await this.onPageClosed(browserPageId, webContentsId)
    }
    this.options.onTabsChanged?.(owningWorktreeId)
  }

  /** Retire only the page owner that closed; stale teardown must not close a replacement session. */
  async onPageClosed(browserPageId: string, expectedWebContentsId?: number): Promise<void> {
    const sessionName = `${ORCA_TAB_SESSION_PREFIX}${browserPageId}`
    if (expectedWebContentsId !== undefined) {
      const currentWebContentsId = this.browserManager.getGuestWebContentsId(browserPageId)
      const session = this.sessions.get(sessionName)
      const pending = this.pendingSessionCreation.get(sessionName)
      if (
        (currentWebContentsId !== null && currentWebContentsId !== expectedWebContentsId) ||
        (session && session.webContentsId !== expectedWebContentsId) ||
        (pending && pending.webContentsId !== expectedWebContentsId)
      ) {
        return
      }
    }
    await this.destroySession(sessionName, undefined, expectedWebContentsId)
    this.pendingInterceptRestore.delete(sessionName)
  }

  async onProcessSwap(
    browserPageId: string,
    newWebContentsId: number,
    previousWebContentsId?: number
  ): Promise<void> {
    // Process swaps preserve page IDs but replace the guest and its session.
    const sessionName = `${ORCA_TAB_SESSION_PREFIX}${browserPageId}`
    const session = this.sessions.get(sessionName)
    const pending = this.pendingSessionCreation.get(sessionName)
    const oldWebContentsId =
      previousWebContentsId ?? session?.webContentsId ?? pending?.webContentsId
    if (
      this.browserManager.getGuestWebContentsId(browserPageId) !== newWebContentsId ||
      (session && oldWebContentsId !== session.webContentsId) ||
      (pending && oldWebContentsId !== pending.webContentsId)
    ) {
      return
    }
    const oldOwnerHasSession =
      oldWebContentsId !== undefined &&
      (session?.webContentsId === oldWebContentsId || pending?.webContentsId === oldWebContentsId)
    const oldOwnerHasRoute =
      oldWebContentsId !== undefined &&
      (this.activeWebContentsId === oldWebContentsId ||
        [...this.activeWebContentsPerWorktree.values()].includes(oldWebContentsId) ||
        [...this.heldPersonSelections.values()].includes(oldWebContentsId))
    if (!oldOwnerHasSession && !oldOwnerHasRoute) {
      return
    }
    const owningWorktreeId = this.browserManager.getWorktreeIdForTab(browserPageId)
    if (session && session.activeInterceptPatterns.length > 0) {
      this.pendingInterceptRestore.set(sessionName, [...session.activeInterceptPatterns])
    }
    if (oldWebContentsId !== undefined) {
      await this.destroySession(sessionName, { keepQueuedCommands: true }, oldWebContentsId)
    }
    if (oldWebContentsId != null) {
      this.retargetRouting(oldWebContentsId, newWebContentsId)
    }
    this.options.onTabsChanged?.(owningWorktreeId ?? undefined)
  }
  // A closed popup ends its session and hands the agent back to its opener, not the first listed tab.
  protected watchPopupClose(webContentsId: number): void {
    if (this.watchedPopupWebContentsIds.has(webContentsId)) {
      return
    }
    const popup = this.findPopupPage(webContentsId)
    const contents = popup ? this.getWebContents(webContentsId) : null
    if (!popup || !contents) {
      return
    }
    this.watchedPopupWebContentsIds.add(webContentsId)
    contents.once('destroyed', () => {
      this.watchedPopupWebContentsIds.delete(webContentsId)
      const openerWebContentsId = this.browserManager.getGuestWebContentsId(
        popup.openerBrowserPageId
      )
      // A person's tab pick held while the agent drove the popup must keep waiting on the opener.
      if (
        openerWebContentsId !== null &&
        this.retargetRouting(webContentsId, openerWebContentsId)
      ) {
        this.browserManager.handOverAgentActivity(popup.browserPageId, popup.openerBrowserPageId)
      }
      const closeSession = (): void => void this.onPageClosed(popup.browserPageId, webContentsId)
      // The click that makes a popup close itself reports its own result, not a kill.
      const running = this.sessions.get(
        `${ORCA_TAB_SESSION_PREFIX}${popup.browserPageId}`
      )?.activeProcess
      if (running) {
        running.once('close', closeSession)
      } else {
        closeSession()
      }
    })
  }

  protected async destroySession(
    sessionName: string,
    options: AgentBrowserCleanupOptions = { closeTimeoutMs: AGENT_BROWSER_CLEANUP_TIMEOUT_MS },
    expectedWebContentsId?: number
  ): Promise<void> {
    const pendingDestruction = this.pendingSessionDestruction.get(sessionName)
    if (pendingDestruction) {
      await pendingDestruction
      return
    }

    const pendingCreation = this.pendingSessionCreation.get(sessionName)
    if (pendingCreation) {
      if (
        expectedWebContentsId !== undefined &&
        pendingCreation.webContentsId !== expectedWebContentsId
      ) {
        return
      }
      // Wait for creation so a late proxy cannot survive teardown.
      try {
        await pendingCreation.promise
      } catch {
        // The creating caller handles its error; teardown still rejects queued commands.
      }
    }

    const session = this.sessions.get(sessionName)
    if (
      expectedWebContentsId !== undefined &&
      session &&
      session.webContentsId !== expectedWebContentsId
    ) {
      return
    }
    if (!session) {
      if (!options.keepQueuedCommands) {
        this.rejectQueuedCommandsForClosedSession(sessionName)
      }
      return
    }

    this.sessions.delete(sessionName)
    this.pendingSessionCreation.delete(sessionName)
    // Retirement preserves the live page's routes for its replacement session.
    if (options.keepQueuedCommands && session.activeInterceptPatterns.length > 0) {
      this.pendingInterceptRestore.set(sessionName, [...session.activeInterceptPatterns])
    }

    if (!options.keepQueuedCommands) {
      this.rejectQueuedCommandsForClosedSession(sessionName)
    }

    if (session.activeProcess) {
      // Cancel running work immediately instead of waiting for its exec timeout.
      this.cancelledProcesses.add(session.activeProcess)
      try {
        session.activeProcess.kill()
      } catch {}
      session.activeProcess = null
    }

    const destroy = (async (): Promise<void> => {
      try {
        // Close the named daemon within the quit barrier's budget.
        await this.runAgentBrowserRaw(
          sessionName,
          ['--session', sessionName, 'close'],
          options.closeTimeoutMs === undefined ? undefined : { timeoutMs: options.closeTimeoutMs }
        )
        await waitForAgentBrowserSessionExit({
          ownsSocketDirectory: this.ownsAgentBrowserSocketDirectory,
          socketDirectory: this.agentBrowserEnv.AGENT_BROWSER_SOCKET_DIR,
          sessionName
        })
      } catch {}

      await session.proxy.stop()
    })()
    this.pendingSessionDestruction.set(sessionName, destroy)
    try {
      await destroy
    } finally {
      this.pendingSessionDestruction.delete(sessionName)
    }
  }

  protected rejectQueuedCommandsForClosedSession(sessionName: string): void {
    const queue = this.commandQueues.get(sessionName)
    this.commandQueues.delete(sessionName)
    this.processingQueues.delete(sessionName)
    if (queue) {
      const err = new BrowserError(
        'browser_tab_closed',
        'Tab was closed while commands were queued'
      )
      for (const cmd of queue) {
        cmd.reject(err)
      }
      queue.length = 0
    }
  }
}
