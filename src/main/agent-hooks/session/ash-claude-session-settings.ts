import { createHash } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import {
  AshClaudeSessionSettingsConflict,
  publishAshClaudeSessionFile,
  readAshClaudeSessionOwnedFile,
  MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES
} from './ash-claude-session-settings-publication'
export { AshClaudeSessionSettingsConflict } from './ash-claude-session-settings-publication'

/**
 * Experimental, per-session alternative to modifying Claude's shared settings.
 * No production launch path uses this module while AG-07 remains unverified.
 * --settings is a documented Claude CLI input; provider acceptance of hook
 * merging and live status is a separate integration/acceptance gate.
 */
const SESSION_ID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const EVENTS = new Set(['SessionStart', 'Stop'])
const DIRECTORY = 'provider-session-settings'
const RECEIPT_SUFFIX = '.receipt.json'
const SHA256 = /^[a-f0-9]{64}$/

export type AshClaudeSessionHook = {
  event: 'SessionStart' | 'Stop'
  scriptPath: string
  /** Claude hook configuration uses seconds, not milliseconds. */
  timeoutSeconds?: number
}

export type AshClaudeSessionSettings = {
  sessionId: string
  settingsPath: string
  sha256: string
  /** Append to Claude's argv; never concatenate into a shell command string. */
  settingsArgs: readonly ['--settings', string]
}

function validateSession(sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) {
    throw new AshClaudeSessionSettingsConflict('session id is not a UUIDv4')
  }
}

function ensurePrivateRootPath(root: string): void {
  if (!isAbsolute(root) || normalize(root) !== root || root.includes('\0')) {
    throw new AshClaudeSessionSettingsConflict('Ash userData root must be absolute and normalized')
  }
}

async function validatePrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AshClaudeSessionSettingsConflict('Ash session settings directory is not real')
  }
  if (
    process.platform !== 'win32' &&
    ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
  ) {
    throw new AshClaudeSessionSettingsConflict('Ash session settings directory is not private')
  }
}

async function validateAncestors(root: string): Promise<void> {
  let current = root
  for (;;) {
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AshClaudeSessionSettingsConflict('Ash session settings path contains a symlink')
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
}

function quotePosixScript(path: string): string {
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    path.length > 4096 ||
    /[\r\n\0]/.test(path)
  ) {
    throw new AshClaudeSessionSettingsConflict('hook executable must be an absolute safe path')
  }
  // Quote as one POSIX shell word, never interpolate raw executable paths.
  return `'${path.replaceAll("'", "'\\''")}'`
}

export function buildAshClaudeSessionSettings(hooks: readonly AshClaudeSessionHook[]): string {
  if (!hooks.length || hooks.length > EVENTS.size) {
    throw new AshClaudeSessionSettingsConflict('invalid number of session hook events')
  }
  const eventDefinitions: Record<string, unknown> = {}
  for (const hook of hooks) {
    if (!EVENTS.has(hook.event) || Object.hasOwn(eventDefinitions, hook.event)) {
      throw new AshClaudeSessionSettingsConflict('unsupported or duplicate session hook event')
    }
    const timeout = hook.timeoutSeconds ?? 2
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60) {
      throw new AshClaudeSessionSettingsConflict('invalid session hook timeout')
    }
    eventDefinitions[hook.event] = [
      { hooks: [{ type: 'command', command: quotePosixScript(hook.scriptPath), timeout }] }
    ]
  }
  const raw = `${JSON.stringify({ hooks: eventDefinitions }, null, 2)}\n`
  if (Buffer.byteLength(raw) > MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES) {
    throw new AshClaudeSessionSettingsConflict('session settings payload is oversized')
  }
  return raw
}

function expectedPath(root: string, sessionId: string): string {
  ensurePrivateRootPath(root)
  validateSession(sessionId)
  return join(root, DIRECTORY, `claude-${sessionId}.json`)
}

function checksum(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function receiptPath(settingsPath: string): string {
  return `${settingsPath}${RECEIPT_SUFFIX}`
}

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
}): Promise<AshClaudeSessionSettings> {
  const path = expectedPath(args.ashUserData, args.sessionId)
  const raw = buildAshClaudeSessionSettings(args.hooks)
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
  const receipt = `${JSON.stringify({ format: 1, sessionId: args.sessionId, sha256 })}\n`
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
  return {
    sessionId: args.sessionId,
    settingsPath: path,
    sha256,
    settingsArgs: ['--settings', path]
  }
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
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 3 ||
    !('format' in parsed) ||
    parsed.format !== 1 ||
    !('sessionId' in parsed) ||
    parsed.sessionId !== sessionId ||
    !('sha256' in parsed) ||
    typeof parsed.sha256 !== 'string' ||
    !SHA256.test(parsed.sha256)
  ) {
    throw new AshClaudeSessionSettingsConflict('session settings receipt is invalid')
  }
  const record: AshClaudeSessionSettings = {
    sessionId,
    settingsPath: path,
    sha256: parsed.sha256,
    settingsArgs: ['--settings', path]
  }
  await verifyAshClaudeSessionSettings(ashUserData, record)
  return record
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
  if (
    callerArgs.some((arg) => arg === '--settings' || arg.startsWith('--settings=')) ||
    basename(record.settingsPath) !== `claude-${record.sessionId}.json`
  ) {
    throw new AshClaudeSessionSettingsConflict('caller already provides Claude session settings')
  }
  return [...record.settingsArgs, ...callerArgs]
}
