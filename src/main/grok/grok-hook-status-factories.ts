import { join } from 'node:path'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-listener/configuration/agent-hook-types'
import { resolveGrokHomeDir } from '../../shared/grok-session-paths'

/** Inherited Grok hook configuration. Do not write it without Ash provenance. */
export function getConfigPath(): string {
  return join(resolveGrokHomeDir(), 'hooks', 'orca-status.json')
}

export function notInstalledStatus(
  configPath: string,
  detail: string | null = null
): AgentHookInstallStatus {
  return {
    agent: 'grok',
    state: detail ? 'error' : 'not_installed',
    configPath,
    managedHooksPresent: false,
    detail
  }
}

/** Direct service callers must respect the same mutation gate as Settings. */
export function ashGrokMutationUnavailable(): AgentHookInstallStatus {
  return {
    agent: 'grok',
    state: 'skipped',
    configPath: '',
    managedHooksPresent: false,
    skipReason: 'ash_ownership_unavailable',
    detail: 'Ash cannot modify Grok provider-global hooks without verified per-entry ownership.'
  }
}
