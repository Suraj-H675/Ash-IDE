import type { AgentHookInstallStatus } from '../../../../shared/agent-hook-listener/configuration/agent-hook-types'
import { canAshWriteProviderGlobalHooks } from '../../../agent-hooks/ash-hook-ownership-policy'

/** Global Codex hook operations have no verified Ash per-entry ownership yet. */
export function blockedCodexAmbientHookMutation(): AgentHookInstallStatus | null {
  if (canAshWriteProviderGlobalHooks()) {
    return null
  }
  return {
    agent: 'codex',
    state: 'skipped',
    configPath: '',
    managedHooksPresent: false,
    skipReason: 'ash_ownership_unavailable',
    detail: 'Ash cannot modify provider-global Codex hooks without verified per-entry ownership.'
  }
}
