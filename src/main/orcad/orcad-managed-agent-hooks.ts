import { isAgentStatusHooksEnabled } from '../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'
import type { ProfilePreferences } from '../persistence/loading-store/profile-preferences'
import type { OrcadRuntimeCleanup } from './orcad-runtime-lifetime'
import type { AgentHookServer } from '../agent-hooks/server'
import { installLocalHookRootEvidence } from '../agent-hooks/local-hook-root-evidence'

/** SSH and WSL-host panes run beside this host, so it proves which agent owns each pane, from the
 *  first record its startup replay reads. */
export function startOrcadAgentHookServer(
  server: AgentHookServer,
  options: Parameters<AgentHookServer['start']>[0]
): Promise<void> {
  installLocalHookRootEvidence(server)
  return server.start(options)
}

/**
 * Keep the local status receiver responsive to settings, but never register or
 * refresh provider-global hooks until Ash has its own reversible ownership ledger.
 * Terminal agents still launch; unavailable hook status must remain honest.
 */
export function startOrcadManagedAgentHooks(
  store: Pick<ProfilePreferences, 'getSettings' | 'onSettingsChanged'>,
  setStatusHooksEnabled: (enabled: boolean) => void,
  registerCleanup: (cleanup: OrcadRuntimeCleanup) => void
): { readinessPublished: () => void } {
  const removeSettingsListener = store.onSettingsChanged((updates, settings) => {
    if ('agentStatusHooksEnabled' in updates) {
      setStatusHooksEnabled(isAgentStatusHooksEnabled(settings))
    }
  })
  registerCleanup(() => {
    removeSettingsListener()
  })
  return { readinessPublished: () => {} }
}
