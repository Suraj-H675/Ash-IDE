import { lstat, mkdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { ClaudeProfileDescriptor } from '../../claude-accounts/claude-profile-paths'
import {
  verifyClaudeManagedAccountProfile,
  type ClaudeManagedAccountIdentity
} from '../../claude-accounts/claude-managed-account-identity'
import {
  buildAshClaudeSessionSettings,
  checksum,
  expectedPath,
  issueVerifiedSettings,
  isIssuedUnboundSettings,
  receiptPath,
  receiptV1Schema,
  receiptV2Schema,
  sameManagedAccountIdentity,
  validateAncestors,
  validatePrivateDirectory,
  type AshClaudeSessionHook,
  type AshClaudeSessionSettings
} from './ash-claude-session-settings-core'
import {
  AshClaudeSessionSettingsConflict,
  publishAshClaudeSessionFile,
  readAshClaudeSessionOwnedFile,
  MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES
} from './ash-claude-session-settings-publication'
export { AshClaudeSessionSettingsConflict } from './ash-claude-session-settings-publication'
export { buildAshClaudeSessionSettings } from './ash-claude-session-settings-core'
export type {
  AshClaudeSessionHook,
  AshClaudeSessionSettings,
  AshClaudeUnboundSessionSettings,
  AshClaudeManagedSessionSettings
} from './ash-claude-session-settings-core'

/**
 * Experimental, per-session alternative to modifying Claude's shared settings.
 * No production launch path uses this module while AG-07 remains unverified.
 * --settings is a documented Claude CLI input; provider acceptance of hook
 * merging and live status is a separate integration/acceptance gate.
 */
/**
 * Create one Ash-owned session overlay and a durable, independent digest
 * receipt. Publish the overlay first: if that name already exists, never
 * issue a receipt that might adopt another writer's file. A crash between the
 * two publications leaves an untrusted orphan and recovery fails closed.
 * Both live outside the provider's config home; neither is auto-deleted.
 */
export async function createAshClaudeSessionSettings(args: {
  ashUserData: string
  sessionId: string
  hooks: readonly AshClaudeSessionHook[]
  /** Omit for the compatible unbound receipt. Supplied profiles are verified read-only. */
  managedAccountProfile?: ClaudeProfileDescriptor
}): Promise<AshClaudeSessionSettings> {
  const path = expectedPath(args.ashUserData, args.sessionId)
  const raw = buildAshClaudeSessionSettings(args.hooks)
  const accountIdentity = args.managedAccountProfile
    ? await verifyClaudeManagedAccountProfile(args.ashUserData, args.managedAccountProfile)
    : undefined
  await validateAncestors(args.ashUserData)
  await validatePrivateDirectory(args.ashUserData)
  const directory = dirname(path)
  await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error
    }
  })
  await validatePrivateDirectory(directory)
  const sha256 = checksum(raw)
  const receipt = `${JSON.stringify(
    accountIdentity
      ? { format: 2, sessionId: args.sessionId, sha256, account: accountIdentity }
      : { format: 1, sessionId: args.sessionId, sha256 }
  )}\n`
  // A previous interrupted create is ambiguous: never complete its receipt or
  // adopt its settings, even when the bytes happen to match this request.
  const existingReceipt = await lstat(receiptPath(path)).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (existingReceipt) {
    throw new AshClaudeSessionSettingsConflict('session settings already exist')
  }
  // Two durable publications cannot be one atomic operation. Never delete an
  // orphan after a crash: a surviving provider process may still need it.
  await publishAshClaudeSessionFile(path, raw)
  await publishAshClaudeSessionFile(receiptPath(path), receipt)
  if (args.managedAccountProfile && accountIdentity) {
    let afterPublication: ClaudeManagedAccountIdentity
    try {
      afterPublication = await verifyClaudeManagedAccountProfile(
        args.ashUserData,
        args.managedAccountProfile
      )
    } catch {
      throw new AshClaudeSessionSettingsConflict(
        'managed Claude account identity changed during receipt publication'
      )
    }
    if (!sameManagedAccountIdentity(afterPublication, accountIdentity)) {
      throw new AshClaudeSessionSettingsConflict(
        'managed Claude account identity changed during receipt publication'
      )
    }
  }
  return issueVerifiedSettings({
    sessionId: args.sessionId,
    settingsPath: path,
    sha256,
    ...(accountIdentity ? { managedAccountIdentity: accountIdentity } : {}),
    settingsArgs: ['--settings', path]
  })
}

/**
 * Recover only an intact Ash-owned overlay after a host restart. The private
 * receipt is the retained content expectation; never recalculate a "trusted"
 * hash from a changed provider settings file or silently generate a receipt.
 * An incomplete publication must be inspected rather than garbage-collected.
 */
export async function recoverAshClaudeSessionSettings(
  ashUserData: string,
  sessionId: string
): Promise<AshClaudeSessionSettings> {
  const path = expectedPath(ashUserData, sessionId)
  await validateAncestors(ashUserData)
  await validatePrivateDirectory(ashUserData)
  await validatePrivateDirectory(dirname(path))
  const receipt = await readAshClaudeSessionOwnedFile(receiptPath(path), true)
  if (Buffer.byteLength(receipt) > 512) {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is oversized')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(receipt)
  } catch {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is malformed')
  }
  const v1 = receiptV1Schema.safeParse(parsed)
  if (!v1.success || v1.data.sessionId !== sessionId) {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is invalid')
  }
  const record: AshClaudeSessionSettings = {
    sessionId,
    settingsPath: path,
    sha256: v1.data.sha256,
    settingsArgs: ['--settings', path]
  }
  await verifyAshClaudeSessionSettings(ashUserData, record)
  return issueVerifiedSettings(record)
}

/**
 * Recover only a version-2 overlay whose durable managed-account identity
 * still matches the independently verified local profile and marker. Version-1
 * receipts stay readable through the legacy API but are never promoted here.
 */
export async function recoverAshClaudeSessionSettingsForManagedAccount(
  ashUserData: string,
  sessionId: string,
  managedAccountProfile: ClaudeProfileDescriptor
): Promise<AshClaudeSessionSettings> {
  const path = expectedPath(ashUserData, sessionId)
  await validateAncestors(ashUserData)
  await validatePrivateDirectory(ashUserData)
  await validatePrivateDirectory(dirname(path))
  const receipt = await readAshClaudeSessionOwnedFile(receiptPath(path), true)
  if (Buffer.byteLength(receipt) > MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES) {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is oversized')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(receipt)
  } catch {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is malformed')
  }
  const v2 = receiptV2Schema.safeParse(parsed)
  if (!v2.success || v2.data.sessionId !== sessionId) {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is not account-bound')
  }
  const persistedAccount = v2.data.account

  let currentAccount: ClaudeManagedAccountIdentity
  try {
    currentAccount = await verifyClaudeManagedAccountProfile(ashUserData, managedAccountProfile)
  } catch {
    throw new AshClaudeSessionSettingsConflict('managed Claude account identity is unavailable')
  }
  if (!sameManagedAccountIdentity(persistedAccount, currentAccount)) {
    throw new AshClaudeSessionSettingsConflict('managed Claude account changed for this session')
  }

  const record: AshClaudeSessionSettings = {
    sessionId,
    settingsPath: path,
    sha256: v2.data.sha256,
    managedAccountIdentity: persistedAccount,
    settingsArgs: ['--settings', path]
  }
  await verifyAshClaudeSessionSettings(ashUserData, record)
  return issueVerifiedSettings(record)
}

/** Reverify the v2 receipt and account marker before a future main-only resume adapter uses it. */
export async function claudeVerifiedArgsWithManagedAccountAshSessionSettings(
  ashUserData: string,
  sessionId: string,
  managedAccountProfile: ClaudeProfileDescriptor,
  callerArgs: readonly string[]
): Promise<string[]> {
  const record = await recoverAshClaudeSessionSettingsForManagedAccount(
    ashUserData,
    sessionId,
    managedAccountProfile
  )
  return appendAshClaudeSessionSettingsArgs(callerArgs, record)
}

/** Recheck the persisted receipt and overlay on every new process, including resume. */
export async function claudeVerifiedArgsWithAshSessionSettings(
  ashUserData: string,
  sessionId: string,
  callerArgs: readonly string[]
): Promise<string[]> {
  const record = await recoverAshClaudeSessionSettings(ashUserData, sessionId)
  return claudeArgsWithAshSessionSettings(callerArgs, record)
}

/** Verify an unchanged overlay before launching; never fall back to user settings silently. */
export async function verifyAshClaudeSessionSettings(
  ashUserData: string,
  record: AshClaudeSessionSettings
): Promise<void> {
  if (expectedPath(ashUserData, record.sessionId) !== record.settingsPath) {
    throw new AshClaudeSessionSettingsConflict('settings path is not this Ash session')
  }
  await validateAncestors(ashUserData)
  await validatePrivateDirectory(ashUserData)
  await validatePrivateDirectory(dirname(record.settingsPath))
  const raw = await readAshClaudeSessionOwnedFile(record.settingsPath)
  if (checksum(raw) !== record.sha256) {
    throw new AshClaudeSessionSettingsConflict('session settings changed after preparation')
  }
}

/** Preserve caller argv exactly; an existing --settings flag is a conflict, not a replaceable default. */
export function claudeArgsWithAshSessionSettings(
  callerArgs: readonly string[],
  record: AshClaudeSessionSettings
): string[] {
  if (!isIssuedUnboundSettings(record)) {
    throw new AshClaudeSessionSettingsConflict(
      'account-bound Claude settings need managed-account verification'
    )
  }
  return appendAshClaudeSessionSettingsArgs(callerArgs, record)
}

function appendAshClaudeSessionSettingsArgs(
  callerArgs: readonly string[],
  record: AshClaudeSessionSettings
): string[] {
  if (
    callerArgs.some((arg) => arg === '--settings' || arg.startsWith('--settings=')) ||
    basename(record.settingsPath) !== `claude-${record.sessionId}.json`
  ) {
    throw new AshClaudeSessionSettingsConflict('caller already provides Claude session settings')
  }
  return [...record.settingsArgs, ...callerArgs]
}
