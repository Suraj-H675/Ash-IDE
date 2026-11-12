import type {
  AgentHookInstallStatus,
  AgentHookTarget
} from '../../shared/agent-hook-listener/configuration/agent-hook-types'
import { canAshWriteProviderGlobalHooks } from '../agent-hooks/ash-hook-ownership-policy'

/** Direct service entrypoints must honor Ash's global hook ownership gate. */
export function blockedClaudeCompatibleHookMutation(
  agent: AgentHookTarget
): AgentHookInstallStatus | null {
  if (canAshWriteProviderGlobalHooks()) {
    return null
  }
  return {
    agent,
    state: 'skipped',
    configPath: '',
    managedHooksPresent: false,
    skipReason: 'ash_ownership_unavailable',
    detail: 'Ash cannot modify provider-global hooks without verified per-entry ownership.'
  }
}
