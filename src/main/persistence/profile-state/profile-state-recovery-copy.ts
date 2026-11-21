import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  readSync,
  statfsSync,
  writeSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  isSameProfileStateRecoveryDirectory,
  openPinnedLinuxProfileStateRecoveryDirectory,
  snapshotProfileStateRecoveryDirectories
} from './profile-state-recovery-directory'

type RecoveryCopy = { source: string; target: string }

// A descriptor stays attached to the validated inode even when a same-user
// process changes the source pathname. Avoid pathname-based cp/copyFile calls.
const BLOCK_BYTES = 256 * 1024
const MAX_COPY_BYTES = 512 * 1024 * 1024
const MAX_FAMILY_BYTES = 1024 * 1024 * 1024
const MAX_COPY_TIME_MS = 10_000
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
const NONBLOCK = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0

function requireNoUnapprovedLinkedAncestors(path: string): void {
  snapshotProfileStateRecoveryDirectories(canonicalRecoveryPath(path))
}

/** macOS exposes its temporary and variable data roots through the system /var alias. */
function canonicalRecoveryPath(path: string): string {
  const resolved = resolve(path)
  if (process.platform !== 'darwin' || (resolved !== '/var' && !resolved.startsWith('/var/'))) {
    return resolved
  }

  const alias = lstatSync('/var')
  if (!alias.isSymbolicLink()) {
    return resolved
  }
  const canonicalVar = realpathSync('/var')
  const canonicalInfo = lstatSync(canonicalVar)
  if (
    alias.uid !== 0 ||
    canonicalVar !== '/private/var' ||
    !canonicalInfo.isDirectory() ||
    canonicalInfo.isSymbolicLink() ||
    canonicalInfo.uid !== 0 ||
    (canonicalInfo.mode & 0o022) !== 0
  ) {
    throw new Error('Profile-state recovery /var alias is not the trusted macOS system directory')
  }
  return `${canonicalVar}${resolved.slice('/var'.length)}`
}

function isSameSource(source: string, opened: ReturnType<typeof fstatSync>): boolean {
  try {
    const named = lstatSync(source)
    return (
      named.isFile() && named.nlink === 1 && named.dev === opened.dev && named.ino === opened.ino
    )
  } catch {
    return false
  }
}

/** Copy from the validated profile-state inode after caller quiescence. */
export function copyProfileStateRecoveryFile(source: string, target: string): void {
  copyProfileStateRecoveryFileWithinBudget(source, target, performance.now())
}

function copyProfileStateRecoveryFileWithinBudget(
  source: string,
  target: string,
  startedAt: number
): void {
  const sourcePath = canonicalRecoveryPath(source)
  const targetPath = canonicalRecoveryPath(target)
  const parentPath = dirname(sourcePath)
  const outputParentPath = dirname(targetPath)
  const parentSnapshots = snapshotProfileStateRecoveryDirectories(sourcePath)
  const outputParentSnapshots = snapshotProfileStateRecoveryDirectories(targetPath)
  const parentSnapshot = parentSnapshots.at(-1)
  const outputParentSnapshot = outputParentSnapshots.at(-1)
  if (!parentSnapshot || !outputParentSnapshot) {
    throw new Error('Profile-state recovery directory path is incomplete')
  }
  const parentInfo = parentSnapshot.info
  const outputParentInfo = outputParentSnapshot.info
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error('Profile-state recovery source directory is not a real local directory')
  }
  if (!outputParentInfo.isDirectory() || outputParentInfo.isSymbolicLink()) {
    throw new Error('Profile-state recovery destination directory is not a real local directory')
  }
  if (
    process.platform !== 'win32' &&
    typeof process.getuid === 'function' &&
    (parentInfo.uid !== process.getuid() || outputParentInfo.uid !== process.getuid())
  ) {
    throw new Error('Profile-state recovery directories are not owned by this user')
  }
  // Linux opens each component relative to its pinned parent and checks its recorded inode.
  const parentFd =
    process.platform === 'win32'
      ? undefined
      : process.platform === 'linux'
        ? openPinnedLinuxProfileStateRecoveryDirectory(parentSnapshots)
        : openSync(parentPath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NOFOLLOW)
  let outputDirFd: number | undefined
  let from: number | undefined
  let to: number | undefined
  let failure: unknown
  try {
    const parentOpened = parentFd === undefined ? parentInfo : fstatSync(parentFd)
    if (!isSameProfileStateRecoveryDirectory(parentPath, parentOpened, parentInfo)) {
      throw new Error('Profile-state recovery source directory changed before copying')
    }
    const pinnedSource =
      process.platform === 'linux'
        ? `/proc/self/fd/${parentFd}/${basename(sourcePath)}`
        : sourcePath
    from = openSync(pinnedSource, constants.O_RDONLY | NOFOLLOW | NONBLOCK)
    const before = fstatSync(from, { bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX_COPY_BYTES) ||
      (process.platform !== 'win32' &&
        typeof process.getuid === 'function' &&
        before.uid !== BigInt(process.getuid())) ||
      !isSameSource(sourcePath, fstatSync(from))
    ) {
      throw new Error(
        'Profile-state recovery source must be an owned, bounded regular single-link file'
      )
    }

    outputDirFd =
      process.platform === 'win32'
        ? undefined
        : process.platform === 'linux'
          ? openPinnedLinuxProfileStateRecoveryDirectory(outputParentSnapshots)
          : openSync(outputParentPath, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NOFOLLOW)
    const outputDirOpened = outputDirFd === undefined ? outputParentInfo : fstatSync(outputDirFd)
    if (!isSameProfileStateRecoveryDirectory(outputParentPath, outputDirOpened, outputParentInfo)) {
      throw new Error('Profile-state recovery destination directory changed before copying')
    }
    // Check available filesystem space before expanding sparse input files. On
    // Linux, query the same opened directory that anchors the new file.
    if (process.platform !== 'win32') {
      const free = statfsSync(
        process.platform === 'linux' ? `/proc/self/fd/${outputDirFd}` : outputParentPath,
        { bigint: true }
      )
      if (free.bavail * free.bsize < before.size + BigInt(BLOCK_BYTES)) {
        throw new Error('Profile-state recovery requires sufficient free local disk space')
      }
    }
    to = openSync(
      process.platform === 'linux'
        ? `/proc/self/fd/${outputDirFd}/${basename(targetPath)}`
        : targetPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      0o600
    )
    let offset = 0
    const buffer = Buffer.allocUnsafe(BLOCK_BYTES)
    while (offset < Number(before.size)) {
      if (performance.now() - startedAt > MAX_COPY_TIME_MS) {
        throw new Error('Profile-state recovery copy exceeded its synchronous time budget')
      }
      const count = Math.min(buffer.length, Number(before.size) - offset)
      const bytesRead = readSync(from, buffer, 0, count, offset)
      if (performance.now() - startedAt > MAX_COPY_TIME_MS) {
        throw new Error('Profile-state recovery copy exceeded its synchronous time budget')
      }
      if (bytesRead <= 0) {
        throw new Error('Profile-state recovery source changed during copy')
      }
      let written = 0
      while (written < bytesRead) {
        const countWritten = writeSync(to, buffer, written, bytesRead - written)
        if (countWritten <= 0) {
          throw new Error('Profile-state recovery destination could not be written')
        }
        written += countWritten
      }
      if (performance.now() - startedAt > MAX_COPY_TIME_MS) {
        throw new Error('Profile-state recovery copy exceeded its synchronous time budget')
      }
      offset += bytesRead
    }
    const probe = Buffer.allocUnsafe(1)
    const after = fstatSync(from, { bigint: true })
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1n ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      !isSameProfileStateRecoveryDirectory(parentPath, parentOpened, parentInfo) ||
      !isSameProfileStateRecoveryDirectory(outputParentPath, outputDirOpened, outputParentInfo) ||
      !requireUnlinkedAncestorsForResult(sourcePath) ||
      !requireUnlinkedAncestorsForResult(targetPath) ||
      !isSameSource(sourcePath, fstatSync(from)) ||
      readSync(from, probe, 0, 1, offset) !== 0
    ) {
      throw new Error('Profile-state recovery source changed during copy')
    }
    fsyncSync(to)
    if (performance.now() - startedAt > MAX_COPY_TIME_MS) {
      throw new Error('Profile-state recovery copy exceeded its synchronous time budget')
    }
  } catch (error) {
    failure = error
  } finally {
    for (const descriptor of [to, from, outputDirFd, parentFd]) {
      if (descriptor === undefined) {
        continue
      }
      try {
        closeSync(descriptor)
      } catch (error) {
        if (failure === undefined) {
          failure = error
        }
      }
    }
  }
  if (failure !== undefined) {
    throw failure
  }
}

function requireUnlinkedAncestorsForResult(path: string): boolean {
  try {
    requireNoUnapprovedLinkedAncestors(path)
    return true
  } catch {
    return false
  }
}

/** Caller owns maintenance/admission and private staging-directory cleanup. */
export function copyProfileStateRecoveryFiles(files: readonly RecoveryCopy[]): void {
  const startedAt = performance.now()
  let bytes = 0
  for (const { source } of files) {
    const sourcePath = canonicalRecoveryPath(source)
    requireNoUnapprovedLinkedAncestors(sourcePath)
    const info = lstatSync(sourcePath)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error('Profile-state recovery family contains a linked or non-regular file')
    }
    bytes += info.size
    if (!Number.isSafeInteger(bytes) || bytes > MAX_FAMILY_BYTES) {
      throw new Error('Profile-state recovery database family is too large for synchronous copying')
    }
    if (performance.now() - startedAt > MAX_COPY_TIME_MS) {
      throw new Error('Profile-state recovery family exceeded its synchronous time budget')
    }
  }
  for (const { source, target } of files) {
    copyProfileStateRecoveryFileWithinBudget(source, target, startedAt)
  }
}
