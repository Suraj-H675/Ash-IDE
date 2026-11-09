import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { z } from 'zod'
import type { ClaudeManagedAccountIdentity } from '../../claude-accounts/claude-managed-account-identity'
import {
  AshClaudeSessionSettingsConflict,
  MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES
} from './ash-claude-session-settings-publication'

/** Validation, typed issuance and recipe data shared by v1/v2 overlay flows. */
const SESSION_ID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const EVENTS = new Set(['SessionStart', 'Stop'])
const DIRECTORY = 'provider-session-settings'
const RECEIPT_SUFFIX = '.receipt.json'
const SHA256 = /^[a-f0-9]{64}$/
export const receiptV1Schema = z
  .object({ format: z.literal(1), sessionId: z.string(), sha256: z.string().regex(SHA256) })
  .strict()
const managedAccountIdentitySchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    home: z.string().min(1).max(32_768),
    runtime: z.literal('host'),
    hostPlatform: z.enum(['darwin', 'linux']),
    configHomeIdentity: z.string().min(1).max(32_768),
    configHomeDevice: z.string().regex(/^(0|[1-9]\d{0,39})$/),
    configHomeInode: z.string().regex(/^(0|[1-9]\d{0,39})$/),
    ownershipMarkerSha256: z.string().regex(SHA256)
  })
  .strict()
export const receiptV2Schema = z
  .object({
    format: z.literal(2),
    sessionId: z.string(),
    sha256: z.string().regex(SHA256),
    account: managedAccountIdentitySchema
  })
  .strict()

export type AshClaudeSessionHook = {
  event: 'SessionStart' | 'Stop'
  scriptPath: string
  /** Claude hook configuration uses seconds, not milliseconds. */
  timeoutSeconds?: number
}

type AshClaudeSessionSettingsCore = {
  readonly sessionId: string
  readonly settingsPath: string
  readonly sha256: string
  /** Append to Claude's argv; never concatenate into a shell command string. */
  readonly settingsArgs: readonly ['--settings', string]
}

export type AshClaudeUnboundSessionSettings = AshClaudeSessionSettingsCore & {
  readonly managedAccountIdentity?: never
}
export type AshClaudeManagedSessionSettings = AshClaudeSessionSettingsCore & {
  readonly managedAccountIdentity: Readonly<ClaudeManagedAccountIdentity>
}
export type AshClaudeSessionSettings =
  | AshClaudeUnboundSessionSettings
  | AshClaudeManagedSessionSettings

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

export async function validatePrivateDirectory(path: string): Promise<void> {
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

export async function validateAncestors(root: string): Promise<void> {
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

export function expectedPath(root: string, sessionId: string): string {
  ensurePrivateRootPath(root)
  validateSession(sessionId)
  return join(root, DIRECTORY, `claude-${sessionId}.json`)
}

export function checksum(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function sameManagedAccountIdentity(
  left: ClaudeManagedAccountIdentity,
  right: ClaudeManagedAccountIdentity
): boolean {
  return (
    left.version === right.version &&
    left.accountId === right.accountId &&
    left.home === right.home &&
    left.runtime === right.runtime &&
    left.hostPlatform === right.hostPlatform &&
    left.configHomeIdentity === right.configHomeIdentity &&
    left.configHomeDevice === right.configHomeDevice &&
    left.configHomeInode === right.configHomeInode &&
    left.ownershipMarkerSha256 === right.ownershipMarkerSha256
  )
}

export function receiptPath(settingsPath: string): string {
  return `${settingsPath}${RECEIPT_SUFFIX}`
}
