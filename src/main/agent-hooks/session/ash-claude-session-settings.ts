import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, unlink, link } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'

/**
 * Experimental, per-session alternative to modifying Claude's shared settings.
 * No production launch path uses this module while AG-07 remains unverified.
 * --settings is a documented Claude CLI input; provider acceptance of hook
 * merging and live status is a separate integration/acceptance gate.
 */
export class AshClaudeSessionSettingsConflict extends Error {
  constructor(reason: string) {
    super(`Ash Claude session settings conflict: ${reason}`)
    this.name = 'AshClaudeSessionSettingsConflict'
  }
}

const SESSION_ID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const EVENTS = new Set(['SessionStart', 'Stop'])
const MAX_BYTES = 16 * 1024
const DIRECTORY = 'provider-session-settings'

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

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  const dir = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
  try {
    await dir.sync()
  } finally {
    await dir.close()
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
  if (Buffer.byteLength(raw) > MAX_BYTES) {
    throw new AshClaudeSessionSettingsConflict('session settings payload is oversized')
  }
  return raw
}

function expectedPath(root: string, sessionId: string): string {
  ensurePrivateRootPath(root)
  validateSession(sessionId)
  return join(root, DIRECTORY, `claude-${sessionId}.json`)
}

async function readOwned(path: string): Promise<string> {
  const stat = await lstat(path)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > MAX_BYTES ||
    (process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))
  ) {
    throw new AshClaudeSessionSettingsConflict(
      'session settings file is not a private regular file'
    )
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await file.stat()
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1) {
      throw new AshClaudeSessionSettingsConflict('session settings file changed while opening')
    }
    const raw = await file.readFile('utf8')
    const after = await file.stat()
    if (
      Buffer.byteLength(raw) > MAX_BYTES ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs
    ) {
      throw new AshClaudeSessionSettingsConflict('session settings file changed while reading')
    }
    return raw
  } finally {
    await file.close()
  }
}

function checksum(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Creates one immutable-by-contract Ash-owned settings overlay under private
 * userData. No Claude config directory, workspace settings, or provider tokens
 * are read or written. O_EXCL hardlink publication never overwrites a session.
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
  const stage = `${path}.stage`
  let file
  try {
    file = await open(stage, 'wx', 0o600)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new AshClaudeSessionSettingsConflict('session settings stage already exists')
    }
    throw error
  }
  const owned = await file.stat()
  try {
    try {
      await file.writeFile(raw, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await syncDirectory(directory)
    try {
      await link(stage, path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new AshClaudeSessionSettingsConflict('session settings already exist')
      }
      throw error
    }
    await syncDirectory(directory)
  } finally {
    // A duplicate session or failed publication must not leave a stage that
    // prevents retry. Never unlink a stage another writer replaced.
    const stillStage = await lstat(stage).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (stillStage && stillStage.ino === owned.ino && stillStage.dev === owned.dev) {
      await unlink(stage)
      await syncDirectory(directory)
    }
  }
  return {
    sessionId: args.sessionId,
    settingsPath: path,
    sha256: checksum(raw),
    settingsArgs: ['--settings', path]
  }
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
  const raw = await readOwned(record.settingsPath)
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
