import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  readSync,
  readdirSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { MAX_POINTER_BYTES } from './offline-update-transaction-limits'
import type { TransactionJournal } from './offline-update-transaction-types'
import {
  missing,
  requirePrivateDirectory,
  sameFileSnapshot
} from './offline-update-transaction-paths'

export function syncDirectoryStrict(directory: string): void {
  const fd = openSync(
    directory,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | constants.O_NOFOLLOW
  )
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export function createPrivateChildDirectory(parent: string, name: string): string {
  if (name.includes('/') || name === '.' || name === '..') {
    throw new Error('Offline update directory name is invalid')
  }
  const directory = join(parent, name)
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (
      !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
    ) {
      throw error
    }
  }
  const validated = requirePrivateDirectory(directory)
  syncDirectoryStrict(parent)
  return validated
}

export function renameDurablyStrict(tmpPath: string, finalPath: string): void {
  renameSync(tmpPath, finalPath)
  syncDirectoryStrict(dirname(finalPath))
}

export function makeStagingTreeRemovable(path: string): void {
  const info = lstatSync(path)
  if (info.uid !== process.getuid?.() || info.isSymbolicLink()) {
    throw new Error('Offline update staging cleanup refuses linked or foreign entries')
  }
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) {
      makeStagingTreeRemovable(join(path, name))
    }
    chmodSync(path, 0o700)
    return
  }
  if (!info.isFile() || info.nlink !== 1) {
    throw new Error('Offline update staging cleanup refuses non-regular or linked files')
  }
  chmodSync(path, 0o600)
}

export function removeStagingDirectoryIfPresent(parentPath: string, name: string): void {
  let parent: string
  try {
    parent = requirePrivateDirectory(parentPath)
  } catch (error) {
    if (missing(error)) {
      return
    }
    throw error
  }
  const path = join(parent, name)
  let info: ReturnType<typeof lstatSync>
  try {
    info = lstatSync(path)
  } catch (error) {
    if (missing(error)) {
      syncDirectoryStrict(parent)
      return
    }
    throw error
  }
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) {
    throw new Error('Offline update staging cleanup refuses a changed directory')
  }
  makeStagingTreeRemovable(path)
  rmSync(path, { recursive: true })
  syncDirectoryStrict(parent)
}

export function removeJournalStagingDirectories(
  installRoot: string,
  dataRoot: string,
  journal: TransactionJournal
): void {
  const suffix = `.staging-${journal.transactionId}`
  removeStagingDirectoryIfPresent(
    join(installRoot, '.ash-offline-update', 'slots'),
    `${journal.candidateGenerationId}${suffix}`
  )
  removeStagingDirectoryIfPresent(
    join(dataRoot, '.ash-offline-update', 'generations'),
    `${journal.candidateGenerationId}${suffix}`
  )
}

export function writeJsonDurably(
  path: string,
  value: unknown,
  maximumBytes = MAX_POINTER_BYTES
): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  if (bytes.length > maximumBytes) {
    throw new Error('Offline update JSON exceeds its bounded storage limit')
  }
  let fd: number | undefined
  let published = false
  let failed = false
  let primaryFailure: unknown
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
    let offset = 0
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset)
      if (count <= 0) {
        throw new Error('Offline update journal could not be written completely')
      }
      offset += count
    }
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameDurablyStrict(temporary, path)
    published = true
  } catch (error) {
    failed = true
    primaryFailure = error
  }

  const cleanupFailures: unknown[] = []
  if (fd !== undefined) {
    try {
      closeSync(fd)
    } catch (error) {
      cleanupFailures.push(error)
    }
    fd = undefined
  }
  if (!published) {
    let removed = false
    try {
      unlinkSync(temporary)
      removed = true
    } catch (error) {
      if (!missing(error)) {
        cleanupFailures.push(error)
      }
    }
    if (removed) {
      try {
        syncDirectoryStrict(dirname(path))
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
  }

  if (failed) {
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [primaryFailure, ...cleanupFailures],
        'Offline update JSON write failed and temporary-file cleanup also failed'
      )
    }
    throw primaryFailure
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Offline update JSON cleanup failed')
  }
}

export function readSmallJson<T>(path: string, maximumBytes = MAX_POINTER_BYTES): T | null {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0))
    const before = fstatSync(fd, { bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.uid !== BigInt(process.getuid?.() ?? -1) ||
      (before.mode & 0o077n) !== 0n ||
      before.size > BigInt(maximumBytes) ||
      !sameFileSnapshot(path, fstatSync(fd))
    ) {
      throw new Error('Offline update JSON is linked or oversized')
    }
    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) {
        throw new Error('Offline update JSON ended before its recorded size')
      }
      offset += count
    }
    const after = fstatSync(fd, { bigint: true })
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      !sameFileSnapshot(path, fstatSync(fd))
    ) {
      throw new Error('Offline update JSON changed while it was read')
    }
    const decoded: unknown = JSON.parse(bytes.toString('utf8'))
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('Offline update JSON metadata must be a non-null object')
    }
    return decoded as T
  } catch (error) {
    if (missing(error)) {
      return null
    }
    throw error
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}

export function syncPath(path: string, directory = false): void {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | (directory ? (constants.O_DIRECTORY ?? 0) : 0)
  )
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
