import { isAbsolute, normalize } from 'node:path'
import {
  AshClaudeSessionSettingsConflict,
  claudeVerifiedArgsWithAshSessionSettings
} from '../../../agent-hooks/session/ash-claude-session-settings'
import { CLAUDE_AUTH_ENV_VARS } from '../../../claude-accounts/environment'
import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../../../shared/claude-profile-routing'
import {
  buildShellCommandFromArgv,
  tokenizeStartupCommand,
  type AgentStartupShell
} from '../../../../shared/agent-launch/startup/tui-agent-startup-shell'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'

const SESSION_UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const SUPPORTED_HOST_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux'])
const ACCOUNT_OVERRIDE_KEYS = new Set<string>([
  'CLAUDE_CONFIG_DIR',
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV,
  ...CLAUDE_AUTH_ENV_VARS,
  'ANTHROPIC_CUSTOM_HEADERS'
])
const RESUME_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

export type HostClaudeSessionOverlayLaunchRequest = {
  mode: 'fresh' | 'resume'
  sessionId: string
  accountId: string
  accountConfigDir: string
}

export type HostClaudeSessionOverlayAccount = {
  id: string
  configDir: string
}

export type HostClaudeSessionOverlayContext = {
  launchAgent: TuiAgent | undefined
  providerSession?: AgentProviderSessionMetadata
  command: string
  executionPlatform: NodeJS.Platform
  hostPlatform: NodeJS.Platform
  isRemote: boolean
  isWsl: boolean
  isLiveReattach: boolean
  shell: AgentStartupShell
  shellOverride?: string
  selectedAccount: HostClaudeSessionOverlayAccount | null
  effectiveEnv: Readonly<Record<string, string | undefined>>
  callerEnvOverrides?: readonly Readonly<Record<string, string | undefined>>[]
  ambientEnv: Readonly<Record<string, string | undefined>>
}

export type HostClaudeSessionOverlayLaunch =
  | { kind: 'disabled' }
  | {
      kind: 'prepared'
      sessionId: string
      settingsPath: string
      argv: readonly string[]
      command: string
    }

function refuse(reason: string): never {
  throw new AshClaudeSessionSettingsConflict(reason)
}

function isSafeAbsolutePath(value: string): boolean {
  return isAbsolute(value) && normalize(value) === value && !/[\0\r\n]/.test(value)
}

function hasOverride(env: Readonly<Record<string, string | undefined>>): boolean {
  return Object.keys(env).some((key) => ACCOUNT_OVERRIDE_KEYS.has(key))
}

function commandArgsForSession(
  args: readonly string[],
  request: HostClaudeSessionOverlayLaunchRequest
): void {
  if (args.some((arg) => arg === '--settings' || arg.startsWith('--settings='))) {
    refuse('caller already provides Claude session settings')
  }
  if (args.includes('--')) {
    refuse('Claude session overlay does not support an option terminator')
  }
  const selector = request.mode === 'resume' ? '--resume' : '--session-id'
  const selectors = args
    .map((arg, index) => ({ arg, index }))
    .filter(
      ({ arg }) =>
        ['--resume', '--continue', '-r', '-c', '--session-id'].includes(arg) ||
        arg.startsWith('--resume=') ||
        arg.startsWith('--continue=') ||
        arg.startsWith('--session-id=')
    )
  if (selectors.length !== 1 || selectors[0].arg !== selector) {
    refuse('Claude command does not name one supported session selector')
  }
  const { index } = selectors[0]
  if (args[index + 1] !== request.sessionId || index + 2 !== args.length) {
    refuse('Claude command session does not match the overlay session')
  }
  const prefix = args.slice(0, index)
  if (
    prefix.length !== 0 &&
    !(prefix.length === 2 && prefix[0] === '--effort' && RESUME_EFFORTS.has(prefix[1]))
  ) {
    refuse('Claude command contains unsupported launch arguments')
  }
}

/**
 * Build a per-process Claude command only from an explicit host-owned intent and verified receipt.
 * Keep this adapter dormant until a host caller can bind the provider UUID to the selected account.
 */
export async function prepareHostClaudeSessionOverlayLaunch(args: {
  request?: HostClaudeSessionOverlayLaunchRequest
  userDataPath?: string
  context?: HostClaudeSessionOverlayContext
}): Promise<HostClaudeSessionOverlayLaunch> {
  if (!args.request) {
    return { kind: 'disabled' }
  }
  const { request, context, userDataPath } = args
  if (!context || !userDataPath) {
    refuse('host Claude session overlay launch context is incomplete')
  }
  if (request.mode !== 'fresh' && request.mode !== 'resume') {
    refuse('unsupported Claude session overlay launch mode')
  }
  if (!SESSION_UUID.test(request.sessionId)) {
    refuse('session id is not a UUIDv4')
  }
  if (
    context.launchAgent !== 'claude' ||
    context.isRemote !== false ||
    context.isWsl !== false ||
    context.isLiveReattach !== false ||
    !SUPPORTED_HOST_PLATFORMS.has(context.hostPlatform) ||
    context.hostPlatform !== process.platform ||
    context.executionPlatform !== context.hostPlatform ||
    context.shell !== 'posix' ||
    context.shellOverride
  ) {
    refuse('Claude session overlay supports only a local host POSIX launch')
  }
  if (request.mode === 'resume') {
    if (
      context.providerSession?.key !== 'session_id' ||
      context.providerSession.id !== request.sessionId
    ) {
      refuse('provider session does not match the overlay session')
    }
  } else if (context.providerSession) {
    refuse('fresh Claude launch cannot combine with a saved provider session')
  }
  if (
    !request.accountId.trim() ||
    !isSafeAbsolutePath(request.accountConfigDir) ||
    !context.selectedAccount ||
    context.selectedAccount.id !== request.accountId ||
    context.selectedAccount.configDir !== request.accountConfigDir ||
    context.effectiveEnv.CLAUDE_CONFIG_DIR !== request.accountConfigDir ||
    context.effectiveEnv[CLAUDE_INJECTED_CONFIG_DIR_ENV] !== request.accountConfigDir ||
    context.effectiveEnv[CLAUDE_PROFILE_POINTER_ENV] !== undefined ||
    context.effectiveEnv[CLAUDE_USER_CONFIG_DIR_ENV] !== undefined
  ) {
    refuse('selected Claude account is unknown or changed for this launch')
  }
  if (
    context.callerEnvOverrides?.some(hasOverride) ||
    Object.keys(context.ambientEnv).some((key) => ACCOUNT_OVERRIDE_KEYS.has(key))
  ) {
    refuse('Claude account or authentication environment is overridden')
  }
  if (!isSafeAbsolutePath(userDataPath)) {
    refuse('Ash userData root must be absolute and normalized')
  }

  const parsed = tokenizeStartupCommand(context.command, context.shell)
  if (
    !parsed.ok ||
    parsed.spans.some((span) => span.divergesFromShell) ||
    /[;&|<>`$()\r\n]/.test(context.command) ||
    parsed.tokens[0] !== 'claude'
  ) {
    refuse('Claude command uses unsupported shell syntax')
  }
  commandArgsForSession(parsed.tokens.slice(1), request)

  const argv = await claudeVerifiedArgsWithAshSessionSettings(
    userDataPath,
    request.sessionId,
    parsed.tokens.slice(1)
  )
  const settingsPath = argv[1]
  if (argv[0] !== '--settings' || !settingsPath) {
    refuse('verified Claude settings arguments are incomplete')
  }
  const fullArgv = [parsed.tokens[0], ...argv]
  return {
    kind: 'prepared',
    sessionId: request.sessionId,
    settingsPath,
    argv: fullArgv,
    command: buildShellCommandFromArgv(fullArgv, context.shell)
  }
}
