import { dirname } from 'node:path'
import type { ClaudeManagedAccountIdentity } from '../../../claude-accounts/claude-managed-account-identity'
import {
  describeClaudeProfile,
  type ClaudeProfileDescriptor
} from '../../../claude-accounts/claude-profile-paths'
import { recoverAshClaudeSessionSettingsForManagedAccount } from '../../../agent-hooks/session/ash-claude-session-settings'
import {
  expectedPath,
  receiptPath,
  receiptV2Schema,
  sameManagedAccountIdentity,
  validateAncestors,
  validatePrivateDirectory
} from '../../../agent-hooks/session/ash-claude-session-settings-core'
import {
  AshClaudeSessionSettingsConflict,
  MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES,
  readAshClaudeSessionOwnedFile
} from '../../../agent-hooks/session/ash-claude-session-settings-publication'

const SESSION_UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const LOCAL_POSIX_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux'])
const NON_LOCAL_FLAGS = [
  'remote',
  'isRemote',
  'wsl',
  'isWsl',
  'forked',
  'isFork',
  'anonymous',
  'isAnonymous'
] as const
const FORK_REFERENCES = [
  'forkedFrom',
  'forkedFromSessionId',
  'parentSessionId',
  'parentId'
] as const

type UnknownRecord = Record<string, unknown>

export type RecoveredClaudeSessionOverlayConsistency = Readonly<{
  kind: 'consistency-only'
  sessionId: string
  originalProfile: Readonly<ClaudeProfileDescriptor>
  managedAccountIdentity: Readonly<ClaudeManagedAccountIdentity>
  // Intentionally no spawn-ready argv or launch command: status/renderer UUIDs
  // are not independently authenticated PTY-session acquisition evidence.
}>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null
}

function reject(reason: string): never {
  throw new AshClaudeSessionSettingsConflict(reason)
}

function readSavedSessionId(record: unknown): string {
  const saved = asRecord(record)
  if (!saved || saved.agent !== 'claude') {
    return reject('saved session is not a Claude session')
  }
  if (saved.connectionId !== undefined && saved.connectionId !== null) {
    return reject('saved session is remote')
  }
  const providerSession = asRecord(saved.providerSession)
  if (providerSession?.key !== 'session_id' || typeof providerSession.id !== 'string') {
    return reject('saved provider session is not a Claude session_id')
  }
  if (!SESSION_UUID.test(providerSession.id)) {
    return reject('saved Claude session id is not a UUIDv4')
  }
  rejectContradictoryHints(saved, providerSession)
  return providerSession.id
}

function rejectContradictoryHints(saved: UnknownRecord, providerSession: UnknownRecord): void {
  for (const source of [saved, providerSession]) {
    for (const key of NON_LOCAL_FLAGS) {
      if (source[key] === true) {
        reject(`saved session has a ${key} marker`)
      }
    }
    for (const key of FORK_REFERENCES) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        reject('saved Claude session has fork metadata')
      }
    }
    if (source.runtime !== undefined && source.runtime !== 'host') {
      reject('saved Claude session is not a host session')
    }
    if (source.executionHostId !== undefined && source.executionHostId !== 'local') {
      reject('saved Claude session is not local')
    }
    for (const key of ['provider', 'providerId', 'providerName']) {
      if (source[key] !== undefined && source[key] !== 'claude') {
        reject('saved provider does not match Claude')
      }
    }
  }

  const launchConfig = asRecord(saved.launchConfig)
  const launchEnv = asRecord(launchConfig?.agentEnv)
  if (
    launchEnv &&
    (Object.hasOwn(launchEnv, 'WSL_DISTRO_NAME') || Object.hasOwn(launchEnv, 'WSL_INTEROP'))
  ) {
    reject('saved Claude launch environment indicates WSL')
  }
  const agentCommand = launchConfig?.agentCommand
  if (
    typeof agentCommand === 'string' &&
    /(?:^|\s)(?:wsl(?:\.exe)?|ssh)(?:\s|$)/i.test(agentCommand)
  ) {
    reject('saved Claude launch command indicates a remote runtime')
  }
}

async function readAccountBoundReceipt(
  ashUserData: string,
  sessionId: string
): Promise<ReturnType<typeof receiptV2Schema.parse>> {
  const settings = expectedPath(ashUserData, sessionId)
  await validateAncestors(ashUserData)
  await validatePrivateDirectory(ashUserData)
  await validatePrivateDirectory(dirname(settings))

  const path = receiptPath(settings)
  const raw = await readAshClaudeSessionOwnedFile(path, true)
  if (Buffer.byteLength(raw) > MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES) {
    reject('session settings receipt is oversized')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    reject('session settings receipt is malformed')
  }
  const receipt = receiptV2Schema.safeParse(parsed)
  if (!receipt.success || receipt.data.sessionId !== sessionId) {
    reject('session settings receipt is not account-bound to this session')
  }
  return receipt.data
}

/**
 * Read-only main-process consistency validation for a saved Claude session.
 * The saved hook/renderer record supplies an unverified UUID, so this result
 * cannot authorize production spawn, reattach, status, RPC, or renderer flows.
 */
export async function recoverOriginalManagedClaudeAccountForSavedSession(args: {
  ashUserData: string
  record: unknown
}): Promise<RecoveredClaudeSessionOverlayConsistency> {
  if (!LOCAL_POSIX_PLATFORMS.has(process.platform)) {
    reject('saved Claude overlay recovery supports only local Linux and macOS')
  }
  const sessionId = readSavedSessionId(args.record)
  const receipt = await readAccountBoundReceipt(args.ashUserData, sessionId)

  let originalProfile: ClaudeProfileDescriptor
  try {
    originalProfile = describeClaudeProfile(args.ashUserData, receipt.account.accountId, {
      runtime: 'host',
      executionHostId: 'local'
    })
  } catch {
    reject('receipt account is not a local managed Claude profile')
  }

  const settings = await recoverAshClaudeSessionSettingsForManagedAccount(
    args.ashUserData,
    sessionId,
    originalProfile
  )
  const verifiedIdentity = settings.managedAccountIdentity
  if (!verifiedIdentity || !sameManagedAccountIdentity(receipt.account, verifiedIdentity)) {
    reject('managed Claude account receipt changed during recovery')
  }

  const frozenProfile = Object.freeze({
    ...originalProfile,
    target: Object.freeze({ ...originalProfile.target })
  })
  return Object.freeze({
    kind: 'consistency-only',
    sessionId,
    originalProfile: frozenProfile,
    managedAccountIdentity: verifiedIdentity
  })
}
