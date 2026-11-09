import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path'
import type { ClaudeProfileDescriptor } from './claude-profile-paths'
import { claudeProfileMarkerPath, describeClaudeProfile } from './claude-profile-paths'

const ACCOUNT_ID = /^[a-zA-Z0-9_-]+$/
const MAX_MARKER_BYTES = 512
const HOST_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux'])

export type ClaudeManagedAccountIdentity = {
  version: 1
  accountId: string
  home: string
  runtime: 'host'
  hostPlatform: 'darwin' | 'linux'
  configHomeIdentity: string
  /** Durable physical directory identity, not merely a reusable pathname. */
  configHomeDevice: string
  configHomeInode: string
  ownershipMarkerSha256: string
}

export class ClaudeManagedAccountIdentityError extends Error {
  constructor(reason: string) {
    super(`Claude managed account identity is unavailable: ${reason}`)
    this.name = 'ClaudeManagedAccountIdentityError'
  }
}

function refuse(reason: string): never {
  throw new ClaudeManagedAccountIdentityError(reason)
}

function assertPrivateDirectory(path: string, label: string): void {
  if (!isAbsolute(path) || normalize(path) !== path || path.includes('\0')) {
    refuse(`${label} path is not normalized`)
  }
}

async function verifyPhysicalDirectoryPath(path: string): Promise<void> {
  let cursor = resolve(path)
  for (;;) {
    const stat = await lstat(cursor).catch(() => refuse('profile path is missing or unreadable'))
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      refuse('profile path contains a symlink or non-directory')
    }
    const parent = dirname(cursor)
    if (parent === cursor) {
      return
    }
    cursor = parent
  }
}

async function readOwnedMarker(path: string, expected: string): Promise<string> {
  const before = await lstat(path).catch(() => refuse('ownership marker is missing or unreadable'))
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > MAX_MARKER_BYTES ||
    (process.platform !== 'win32' &&
      ((before.mode & 0o077) !== 0 || (process.getuid && before.uid !== process.getuid())))
  ) {
    refuse('ownership marker is not a private regular file')
  }

  let file
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch {
    refuse('ownership marker changed while opening')
  }
  try {
    const opened = await file.stat()
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== before.nlink ||
      !opened.isFile()
    ) {
      refuse('ownership marker changed while opening')
    }
    const raw = await file.readFile('utf8')
    const after = await file.stat()
    if (
      Buffer.byteLength(raw) > MAX_MARKER_BYTES ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      opened.nlink !== after.nlink
    ) {
      refuse('ownership marker changed while reading')
    }
    if (raw !== expected) {
      refuse('ownership marker does not match this managed account')
    }
    return raw
  } finally {
    await file.close()
  }
}

/**
 * Read-only identity proof for one host managed profile. It checks the same
 * version-1 marker written by profile setup, the canonical physical config
 * home, and every path component for symlinks. It never creates or repairs a
 * profile.
 */
export async function verifyClaudeManagedAccountProfile(
  dataRoot: string,
  profile: ClaudeProfileDescriptor
): Promise<ClaudeManagedAccountIdentity> {
  assertPrivateDirectory(dataRoot, 'Ash data root')
  if (!HOST_PLATFORMS.has(process.platform)) {
    refuse('only local Linux and macOS profiles are supported')
  }
  if (
    !profile ||
    profile.version !== 1 ||
    !ACCOUNT_ID.test(profile.accountId) ||
    !profile.target ||
    profile.target.runtime !== 'host' ||
    profile.target.executionHostId !== 'local' ||
    Object.keys(profile.target).some((key) => !['executionHostId', 'runtime'].includes(key))
  ) {
    refuse('profile is not a local host managed account')
  }

  let expected: ClaudeProfileDescriptor
  try {
    expected = describeClaudeProfile(dataRoot, profile.accountId, {
      executionHostId: 'local',
      runtime: 'host'
    })
  } catch {
    refuse('managed profile descriptor is invalid')
  }
  if (profile.home !== expected.home) {
    refuse('config home is outside this managed account namespace')
  }
  await verifyPhysicalDirectoryPath(dataRoot)
  const rootStat = await lstat(dataRoot)
  if (
    process.platform !== 'win32' &&
    ((rootStat.mode & 0o077) !== 0 || (process.getuid && rootStat.uid !== process.getuid()))
  ) {
    refuse('Ash data root is not private')
  }
  await verifyPhysicalDirectoryPath(profile.home)
  const homeStat = await lstat(profile.home, { bigint: true })
  if (
    !homeStat.isDirectory() ||
    homeStat.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      ((homeStat.mode & 0o077n) !== 0n ||
        (process.getuid && homeStat.uid !== BigInt(process.getuid()))))
  ) {
    refuse('managed config home is not a private physical directory')
  }

  const markerPath = claudeProfileMarkerPath(profile)
  if (dirname(markerPath) !== dirname(profile.home) || basename(markerPath) !== 'profile.json') {
    refuse('ownership marker path is invalid')
  }
  const expectedMarker = `${JSON.stringify({
    version: profile.version,
    accountId: profile.accountId,
    runtime: 'host'
  })}\n`
  const marker = await readOwnedMarker(markerPath, expectedMarker)
  const configHomeIdentity = await realpath(profile.home).catch(() =>
    refuse('managed config home has no canonical identity')
  )
  // A symlink-free pathname alone cannot prove continuity: a new directory
  // can be created at the same path while the sibling profile.json survives.
  // Use BigIntStats to preserve large dev/ino values without JS rounding.
  const after = await lstat(profile.home, { bigint: true }).catch(() =>
    refuse('managed config home changed during verification')
  )
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.dev !== homeStat.dev ||
    after.ino !== homeStat.ino
  ) {
    refuse('managed config home changed during verification')
  }

  return {
    version: 1,
    accountId: profile.accountId,
    home: profile.home,
    runtime: 'host',
    hostPlatform: process.platform as 'darwin' | 'linux',
    configHomeIdentity,
    configHomeDevice: homeStat.dev.toString(),
    configHomeInode: homeStat.ino.toString(),
    ownershipMarkerSha256: createHash('sha256').update(marker).digest('hex')
  }
}
