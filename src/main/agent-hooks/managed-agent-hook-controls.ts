import type {
  AgentHookInstallStatus,
  AgentHookTarget
} from '../../shared/agent-hook-listener/configuration/agent-hook-types'
import {
  getManagedAgentHookTarget,
  isManagedAgentHookTarget
} from '../../shared/managed-agent-hook-targets'
import { normalizeDisabledTuiAgents } from '../../shared/agent-launch/catalog/tui-agent-selection'
import { canAshWriteProviderGlobalHooks } from './ash-hook-ownership-policy'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  isAgentStatusHooksEnabled,
  isAgentStatusHooksEnabledForAgent
} from '../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'
import { probeClaudeCliVersion } from '../claude/claude-hook-event-versions'
import { detectLocalManagedAgentCliPresence } from './local-agent-cli-presence'
import {
  MANAGED_AGENT_HOOK_ASYNC_REMOVERS,
  MANAGED_AGENT_HOOK_INSTALLERS,
  MANAGED_AGENT_HOOK_REMOVERS,
  MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS,
  MANAGED_AGENT_HOOK_STATUS_READERS,
  type ManagedAgentHookInstaller,
  type ManagedAgentHookInstallOptions
} from './managed-agent-hook-registry'

type ManagedHookSettings = Partial<
  Pick<GlobalSettings, 'agentCmdOverrides' | 'agentStatusHooksEnabled' | 'disabledTuiAgents'>
> | null

type InstallOptions = {
  /** Set only for an explicit user action, never for startup reconciliation. */
  userInitiated?: boolean
  shouldHydrateShellPath?: boolean
  onInstallError?: (agent: AgentHookTarget, error: unknown) => void
  shouldContinue?: (agent: AgentHookTarget) => boolean
  agents?: readonly AgentHookTarget[]
}

type ApplyOptions = InstallOptions & {
  /** Off means skip, never remove: another Orca's panes run on these same user-global entries. */
  keepSharedEntries?: boolean
}

type RemoveOptions = {
  agents?: readonly AgentHookTarget[]
}

export type StartupManagedHookAction = 'install' | 'skip'

// Settings are per profile but hooks are user-global; startup removal would break other instances.
export function resolveStartupManagedHookAction(
  settings: ManagedHookSettings
): StartupManagedHookAction {
  return isAgentStatusHooksEnabled(settings) ? 'install' : 'skip'
}

export function shouldContinueManagedHookStartup(
  isQuitting: boolean,
  settings: ManagedHookSettings,
  agent: AgentHookTarget
): boolean {
  return !isQuitting && isAgentStatusHooksEnabledForAgent(settings, agent)
}

function errorStatus(agent: AgentHookTarget, error: unknown): AgentHookInstallStatus {
  return {
    agent,
    state: 'error',
    configPath: '',
    managedHooksPresent: false,
    detail: error instanceof Error ? error.message : String(error)
  }
}

function skippedStatus(
  agent: AgentHookTarget,
  skipReason: NonNullable<AgentHookInstallStatus['skipReason']>,
  detail: string
): AgentHookInstallStatus {
  return {
    agent,
    state: 'skipped',
    configPath: '',
    managedHooksPresent: false,
    detail,
    skipReason
  }
}

function selectedInstallers(options: InstallOptions): readonly ManagedAgentHookInstaller[] {
  if (!options.agents) {
    return MANAGED_AGENT_HOOK_INSTALLERS
  }
  const allowed = new Set(options.agents)
  return MANAGED_AGENT_HOOK_INSTALLERS.filter(([agent]) => allowed.has(agent))
}

async function runInstaller(
  entry: ManagedAgentHookInstaller,
  onInstallError: InstallOptions['onInstallError'],
  options: ManagedAgentHookInstallOptions
): Promise<AgentHookInstallStatus> {
  const [agent, install] = entry
  try {
    return await install(options)
  } catch (error) {
    console.error(`[agent-hooks] Failed to install ${agent} managed hooks:`, error)
    try {
      onInstallError?.(agent, error)
    } catch (telemetryError) {
      console.error('[agent-hooks] Failed to record install-failure telemetry:', telemetryError)
    }
    return errorStatus(agent, error)
  }
}

// Refresh owned scripts before CLI presence gating; user-wide configs may still invoke them.
async function refreshExistingManagedScripts(options: InstallOptions): Promise<void> {
  const allowed = options.agents ? new Set(options.agents) : null
  for (const [agent, refresh] of MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS) {
    if (allowed !== null && !allowed.has(agent)) {
      continue
    }
    try {
      await refresh()
    } catch (error) {
      console.error(`[agent-hooks] Failed to refresh ${agent} managed script:`, error)
    }
  }
}

export async function installManagedAgentHooks(
  settings: ManagedHookSettings = null,
  options: InstallOptions = {}
): Promise<AgentHookInstallStatus[]> {
  if (!canAshWriteProviderGlobalHooks()) {
    return ashReadOnlyHookStatuses(isAgentStatusHooksEnabled(settings))
  }
  await refreshExistingManagedScripts(options)
  const installers = selectedInstallers(options)
  const disabled = new Set(normalizeDisabledTuiAgents(settings?.disabledTuiAgents))
  const enabledInstallers = installers.filter(([agent]) => !disabled.has(agent))
  const targets = enabledInstallers.flatMap(([agent]) => {
    const target = getManagedAgentHookTarget(agent)
    return target ? [target] : []
  })
  let presenceByAgent
  try {
    presenceByAgent = await detectLocalManagedAgentCliPresence(targets, settings, {
      shouldHydrateShellPath: options.shouldHydrateShellPath
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return installers.map(([agent]) =>
      disabled.has(agent)
        ? skippedStatus(agent, 'agent_disabled', 'Agent is disabled in Settings.')
        : skippedStatus(agent, 'cli_presence_unknown', detail)
    )
  }

  const results: AgentHookInstallStatus[] = []
  for (const entry of installers) {
    const [agent] = entry
    if (disabled.has(agent)) {
      results.push(skippedStatus(agent, 'agent_disabled', 'Agent is disabled in Settings.'))
      continue
    }
    if (options.shouldContinue && !options.shouldContinue(agent)) {
      results.push(
        skippedStatus(
          agent,
          'hooks_disabled',
          'Agent status hooks were disabled before install completed.'
        )
      )
      continue
    }
    const presence = presenceByAgent[agent]
    if (presence?.state !== 'found') {
      results.push(
        skippedStatus(
          agent,
          presence?.state === 'unknown' ? 'cli_presence_unknown' : 'cli_not_found',
          'CLI not found; managed hook install skipped.'
        )
      )
      continue
    }
    const cliVersion =
      agent === 'claude' && presence.executablePath
        ? await probeClaudeCliVersion(presence.executablePath)
        : null
    results.push(
      await runInstaller(entry, options.onInstallError, {
        ...(options.userInitiated !== undefined ? { userInitiated: options.userInitiated } : {}),
        ...(cliVersion ? { cliVersion } : {})
      })
    )
  }
  return results
}

export async function removeManagedAgentHooks(
  options: RemoveOptions = {}
): Promise<AgentHookInstallStatus[]> {
  const allowed = options.agents ? new Set(options.agents) : null
  if (!canAshWriteProviderGlobalHooks()) {
    // The inherited removers match Orca's shared command patterns, not an
    // Ash-owned per-entry provenance ledger. Even an explicit uninstall must
    // not delete another application's provider hooks. This branch performs
    // no read, probe, refresh, or filesystem mutation.
    return MANAGED_AGENT_HOOK_REMOVERS.filter(
      ([agent]) => allowed === null || allowed.has(agent)
    ).map(([agent]) =>
      skippedStatus(
        agent,
        'ash_ownership_unavailable',
        'Ash has no verified ownership of provider-global hooks; removal skipped and entries left unchanged.'
      )
    )
  }
  const results: AgentHookInstallStatus[] = []
  for (const [agent, remove] of MANAGED_AGENT_HOOK_REMOVERS) {
    if (allowed !== null && !allowed.has(agent)) {
      continue
    }
    try {
      results.push(await remove())
    } catch (error) {
      results.push(errorStatus(agent, error))
    }
  }
  return results
}

export async function removeManagedAgentHooksAsync(
  options: RemoveOptions = {}
): Promise<AgentHookInstallStatus[]> {
  const allowed = options.agents ? new Set(options.agents) : null
  if (!canAshWriteProviderGlobalHooks()) {
    // Grok's async cleanup also mutates a provider-global file. Do not run its
    // owner-pruning or cleanup pipeline without an Ash ownership claim.
    return MANAGED_AGENT_HOOK_ASYNC_REMOVERS.filter(
      ([agent]) => allowed === null || allowed.has(agent)
    ).map(([agent]) =>
      skippedStatus(
        agent,
        'ash_ownership_unavailable',
        'Ash has no verified ownership of provider-global hooks; removal skipped and entries left unchanged.'
      )
    )
  }
  return await Promise.all(
    MANAGED_AGENT_HOOK_ASYNC_REMOVERS.filter(
      ([agent]) => allowed === null || allowed.has(agent)
    ).map(async ([agent, remove]) => {
      try {
        return await remove()
      } catch (error) {
        return errorStatus(agent, error)
      }
    })
  )
}

export function getManagedAgentHookStatuses(): AgentHookInstallStatus[] {
  return MANAGED_AGENT_HOOK_STATUS_READERS.map(([agent, getStatus]) => {
    try {
      return getStatus()
    } catch (error) {
      return errorStatus(agent, error)
    }
  })
}

function ashReadOnlyHookStatuses(enabled: boolean): AgentHookInstallStatus[] {
  return getManagedAgentHookStatuses().map((status) => ({
    ...status,
    state: 'skipped' as const,
    skipReason: enabled ? ('ash_ownership_unavailable' as const) : ('hooks_disabled' as const),
    detail: enabled
      ? 'Ash provider hook installation unavailable until ownership is tracked; provider-global hook entries left unchanged.'
      : 'Ash status monitoring disabled; provider-global hook entries left unchanged.'
  }))
}

export async function applyAgentStatusHooksEnabled(
  enabled: boolean,
  settings: ManagedHookSettings = null,
  options: ApplyOptions = {}
): Promise<AgentHookInstallStatus[]> {
  if (!canAshWriteProviderGlobalHooks()) {
    return ashReadOnlyHookStatuses(enabled)
  }
  if (!enabled) {
    // Provider hook entries are user-global and may belong to Orca or another
    // agent session. Disabling Ash monitoring must not uninstall shared hooks.
    // Preserve the observed on-disk presence, but never report monitoring as active.
    return getManagedAgentHookStatuses().map((status) => ({
      ...status,
      state: 'skipped' as const,
      skipReason: 'hooks_disabled' as const,
      detail: 'Ash status monitoring disabled; provider-global hook entries left unchanged.'
    }))
  }
  const disabled = normalizeDisabledTuiAgents(settings?.disabledTuiAgents).filter(
    isManagedAgentHookTarget
  )
  const installed = await installManagedAgentHooks(settings, options)
  const disabledToRemove = options.shouldContinue
    ? disabled.filter((agent) => !options.shouldContinue?.(agent))
    : disabled
  // Ash's default is non-destructive for disabled agents too. An explicit
  // removal is a separate user action, not an effect of an IDE preference.
  if (disabledToRemove.length === 0 || options.keepSharedEntries !== false) {
    return installed
  }
  const removed = new Map(
    (await removeManagedAgentHooks({ agents: disabledToRemove })).map((status) => [
      status.agent,
      status
    ])
  )
  return installed.map((status) => removed.get(status.agent) ?? status)
}
