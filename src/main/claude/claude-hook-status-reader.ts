import type {
  AgentHookInstallState,
  AgentHookInstallStatus
} from '../../shared/agent-hook-listener/configuration/agent-hook-types'
import { readHooksJson } from '../agent-hooks/installer-utils'
import { refuseProfileAtDefaultHome } from './claude-profile-hook-target'
import type { ClaudeManagedHookPlan } from './claude-managed-hook-events'
import {
  findManagedEventHookForms,
  getConfigPath,
  getManagedEventHook,
  getManagedScriptPath,
  type ClaudeCompatibleHookSettings
} from './hook-settings'
import {
  getWindowsClaudeHookExecutablePath,
  getWindowsClaudeHookFileStatus
} from './windows-hook-files'

/** Nonmutating provider-hook inspection; never assumes an Orca entry belongs to Ash. */
export function readClaudeCompatibleHookStatus(args: {
  agent: AgentHookInstallStatus['agent']
  displayName: string
  settings: ClaudeCompatibleHookSettings
  configDir?: string
  plan: ClaudeManagedHookPlan
}): AgentHookInstallStatus {
  const refused = refuseProfileAtDefaultHome(args, args.configDir)
  if (refused) {
    return refused
  }
  const configPath = getConfigPath(args.settings, args.configDir)
  const scriptPath = getManagedScriptPath(args.settings)
  const config = readHooksJson(configPath)
  if (!config) {
    return {
      agent: args.agent,
      state: 'error',
      configPath,
      managedHooksPresent: false,
      detail: `Could not parse ${args.displayName} settings.json`
    }
  }
  const windowsEntry = process.platform === 'win32' && args.agent === 'claude'
  const exePath = windowsEntry ? getWindowsClaudeHookExecutablePath(scriptPath) : null
  const events = args.plan.install.map((event) => event.eventName)
  const { missing, matchedForms } = findManagedEventHookForms(config, events, (eventName) =>
    [null, exePath].map((path) =>
      getManagedEventHook(eventName, scriptPath, args.settings, path, { execForm: true })
    )
  )
  const presentCount = matchedForms.length
  const managedHooksPresent = presentCount > 0
  let state: AgentHookInstallState
  let detail: string | null
  if (missing.length === 0) {
    state = 'installed'
    detail = null
  } else if (presentCount === 0) {
    state = 'not_installed'
    detail = null
  } else {
    state = 'partial'
    detail = `Managed hook missing for events: ${missing.join(', ')}`
  }
  const status = { agent: args.agent, state, configPath, managedHooksPresent, detail }
  return windowsEntry
    ? getWindowsClaudeHookFileStatus(status, scriptPath, matchedForms.includes(1))
    : status
}
