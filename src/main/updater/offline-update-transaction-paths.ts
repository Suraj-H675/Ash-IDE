import { createHash } from 'node:crypto'
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { MAX_FILE_BYTES, MAX_RELATIVE_PATH_CHARS } from './offline-update-transaction-limits'

export function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

export function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export function requireLinux(): void {
  if (process.platform !== 'linux') {
    throw new Error('Offline Ash update transaction storage is supported only on Linux')
  }
}

export function requirePrivateDirectory(path: string): string {
  const resolved = resolve(path)
  const info = lstatSync(resolved)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    realpathSync(resolved) !== resolved
  ) {
    throw new Error('Offline update roots must be real, private directories owned by this user')
  }
  return resolved
}

export function requireRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_RELATIVE_PATH_CHARS ||
    value.includes('\0') ||
    isAbsolute(value) ||
    value.split(/[\\/]/u).some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('Offline update state paths must be normalized relative paths')
  }
  return value
}

export function requireOwnedDirectoryTree(root: string, relativeDirectory: string): string {
  let current = root
  for (const part of requireRelativePath(relativeDirectory).split('/')) {
    current = join(current, part)
    const info = lstatSync(current)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      realpathSync(current) !== current
    ) {
      throw new Error(
        `Offline update state directory is missing, linked, or foreign: ${relativeDirectory}`
      )
    }
  }
  return current
}

export function requireStableVersion(value: string): void {
  if (!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u.test(value)) {
    throw new Error('Offline update state policy has an invalid product version')
  }
}

export function sameFileSnapshot(path: string, opened: ReturnType<typeof fstatSync>): boolean {
  try {
    const named = lstatSync(path)
    return (
      named.isFile() && named.nlink === 1 && named.dev === opened.dev && named.ino === opened.ino
    )
  } catch {
    return false
  }
}

export function hashOwnedFile(
  path: string,
  maximumBytes = MAX_FILE_BYTES
): { size: number; sha256: string } {
  const resolved = resolve(path)
  const beforePath = lstatSync(resolved, { bigint: true })
  if (
    !beforePath.isFile() ||
    beforePath.nlink !== 1n ||
    beforePath.uid !== BigInt(process.getuid?.() ?? -1) ||
    beforePath.size > BigInt(maximumBytes)
  ) {
    throw new Error('Offline update inputs must be owned, bounded, regular single-link files')
  }
  const fd = openSync(
    resolved,
    constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0)
  )
  try {
    const before = fstatSync(fd, { bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      before.size > BigInt(maximumBytes) ||
      !sameFileSnapshot(resolved, fstatSync(fd))
    ) {
      throw new Error('Offline update input changed before it could be read')
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(256 * 1024)
    let offset = 0
    while (offset < Number(before.size)) {
      const bytesRead = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - offset),
        offset
      )
      if (bytesRead <= 0) {
        throw new Error('Offline update input ended before its recorded size')
      }
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    const after = fstatSync(fd, { bigint: true })
    const probe = Buffer.allocUnsafe(1)
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1n ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      !sameFileSnapshot(resolved, fstatSync(fd)) ||
      readSync(fd, probe, 0, 1, offset) !== 0
    ) {
      throw new Error('Offline update input changed while it was read')
    }
    return { size: Number(before.size), sha256: hash.digest('hex') }
  } finally {
    closeSync(fd)
  }
}
