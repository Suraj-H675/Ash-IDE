import type { AgentBrowserBridge } from '../../../browser/agent-browser/agent-browser-bridge'
import type { BrowserBackend } from '../../../browser/browser-backend'
import { RuntimeWorkspaceNavigation } from '../../workspaces/startup/runtime-workspace-navigation'

export abstract class RuntimeBrowserHostBindings extends RuntimeWorkspaceNavigation {
  // Why: browser profiles change in main's session registry, outside runtime methods.
  notifyBrowserProfilesChanged(): void {
    this.notifier?.browserProfilesChanged?.()
    this.emitClientEvent({ type: 'browserProfilesChanged' })
  }

  setAgentBrowserBridge(bridge: AgentBrowserBridge | null): void {
    this.agentBrowserBridge = bridge
  }

  getAgentBrowserBridge(): AgentBrowserBridge | null {
    return this.agentBrowserBridge
  }

  setOffscreenBrowserBackend(backend: BrowserBackend | null): void {
    this.offscreenBrowserBackend = backend
  }

  getOffscreenBrowserBackend(): BrowserBackend | null {
    const host = this as unknown as { getAvailableAuthoritativeWindow(): unknown }
    return host.getAvailableAuthoritativeWindow() ? null : this.offscreenBrowserBackend
  }

  /** Shutdown owns the installed backend even while a desktop window is still open. */
  getInstalledOffscreenBrowserBackend(): BrowserBackend | null {
    return this.offscreenBrowserBackend
  }
}
