import { CdpWsProxy } from '../cdp/transport/cdp-ws-proxy'
import { BrowserError } from '../browser-error'
import { AgentBrowserBridgeRawProcess } from './agent-browser-bridge-raw-process'
import { AGENT_BROWSER_CLEANUP_TIMEOUT_MS } from './agent-browser-bridge-types'
import { runOutsideRemoteCliBrowserScope } from '../../runtime/desktop-browser-bridge/remote-cli-browser-scope'

export abstract class AgentBrowserBridgeSessionCreation extends AgentBrowserBridgeRawProcess {
  protected async ensureSession(
    sessionName: string,
    browserPageId: string,
    webContentsId: number
  ): Promise<void> {
    const pendingDestruction = this.pendingSessionDestruction.get(sessionName)
    if (pendingDestruction) {
      await pendingDestruction
    }
    this.assertCommandAdmission()

    for (;;) {
      if (this.getRegisteredTabs().get(browserPageId) !== webContentsId) {
        throw new BrowserError(
          'browser_tab_not_found',
          `Browser page ${browserPageId} is no longer owned by this WebContents`
        )
      }

      const existing = this.sessions.get(sessionName)
      if (existing?.webContentsId === webContentsId) {
        return
      }
      if (existing) {
        // A renderer reload gives the page a new guest without a process-swap notice.
        await this.destroySession(
          sessionName,
          {
            closeTimeoutMs: AGENT_BROWSER_CLEANUP_TIMEOUT_MS,
            keepQueuedCommands: true
          },
          existing.webContentsId
        )
        this.assertCommandAdmission()
        continue
      }

      // Coalesce one owner, but never let its completion admit a command for another owner.
      const pending = this.pendingSessionCreation.get(sessionName)
      if (pending) {
        if (pending.webContentsId !== webContentsId) {
          await this.destroySession(
            sessionName,
            {
              closeTimeoutMs: AGENT_BROWSER_CLEANUP_TIMEOUT_MS,
              keepQueuedCommands: true
            },
            pending.webContentsId
          )
          this.assertCommandAdmission()
          continue
        }
        await pending.promise
        this.assertCommandAdmission()
        if (this.sessions.get(sessionName)?.webContentsId === webContentsId) {
          return
        }
        continue
      }
      break
    }

    const createSession = async (): Promise<void> => {
      const wc = this.getWebContents(webContentsId)
      if (!wc || this.getRegisteredTabs().get(browserPageId) !== webContentsId) {
        throw new BrowserError(
          'browser_tab_not_found',
          `Browser page ${browserPageId} is no longer available`
        )
      }

      // Reset daemon sessions that may retain a CDP port from an earlier Orca process.
      await this.closeStaleAgentBrowserSession(sessionName)

      const proxy = new CdpWsProxy(
        wc,
        () => this.browserManager.holdPaintForCapture(webContentsId),
        () => this.browserManager.guardUserFocusForAgentInput(webContentsId),
        (input) => this.browserManager.showAgentPointer(wc, input)
      )
      const cdpEndpoint = await proxy.start()

      if (this.getRegisteredTabs().get(browserPageId) !== webContentsId) {
        await proxy.stop()
        throw new BrowserError(
          'browser_tab_not_found',
          `Browser page ${browserPageId} changed owners during session startup`
        )
      }

      this.sessions.set(sessionName, {
        proxy,
        cdpEndpoint,
        initialized: false,
        consecutiveTimeouts: 0,
        activeInterceptPatterns: [],
        activeCapture: false,
        lastCommandAt: Date.now(),
        webContentsId,
        activeProcess: null
      })
      this.watchPopupClose(webContentsId)
    }

    // Proxy sockets outlive individual remote requests and must not inherit their revocable scope.
    const pendingCreation = {
      webContentsId,
      promise: runOutsideRemoteCliBrowserScope(createSession)
    }
    this.pendingSessionCreation.set(sessionName, pendingCreation)
    try {
      await pendingCreation.promise
    } finally {
      if (this.pendingSessionCreation.get(sessionName) === pendingCreation) {
        this.pendingSessionCreation.delete(sessionName)
      }
    }
  }
}
