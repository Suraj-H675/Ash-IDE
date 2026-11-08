import { constants, type Stats } from 'node:fs'
import { lstat, open, unlink, link } from 'node:fs/promises'
import { dirname } from 'node:path'

export const MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES = 16 * 1024

export class AshClaudeSessionSettingsConflict extends Error {
  constructor(reason: string) {
    super(`Ash Claude session settings conflict: ${reason}`)
    this.name = 'AshClaudeSessionSettingsConflict'
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

/**
 * No-overwrite, crash-durable publication of a private Ash-owned file. A
 * leftover stage or receipt is evidence of an interrupted creation, not an
 * invitation to erase or adopt a possibly-live process's configuration.
 */
export async function publishAshClaudeSessionFile(path: string, raw: string): Promise<void> {
  const directory = dirname(path)
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
    // Never unlink a stage replaced by another writer.
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
}

/** The only accepted extra link is our own private, inode-identical stage. */
async function isPrivateMatchingStage(path: string, target: Stats): Promise<boolean> {
  const stage = await lstat(`${path}.stage`).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  return (
    stage !== null &&
    stage.isFile() &&
    !stage.isSymbolicLink() &&
    stage.ino === target.ino &&
    stage.dev === target.dev &&
    stage.nlink === 2 &&
    (process.platform === 'win32' ||
      ((stage.mode & 0o077) === 0 && (!process.getuid || stage.uid === process.getuid())))
  )
}

export async function readAshClaudeSessionOwnedFile(
  path: string,
  allowPublishedReceiptStage = false
): Promise<string> {
  const stat = await lstat(path)
  const validStage =
    allowPublishedReceiptStage && stat.nlink === 2 && (await isPrivateMatchingStage(path, stat))
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.nlink !== 1 && !validStage) ||
    stat.size > MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES ||
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
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== stat.nlink) {
      throw new AshClaudeSessionSettingsConflict('session settings file changed while opening')
    }
    const raw = await file.readFile('utf8')
    const after = await file.stat()
    if (
      Buffer.byteLength(raw) > MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      opened.nlink !== after.nlink ||
      (validStage && !(await isPrivateMatchingStage(path, after)))
    ) {
      throw new AshClaudeSessionSettingsConflict('session settings file changed while reading')
    }
    return raw
  } finally {
    await file.close()
  }
}
