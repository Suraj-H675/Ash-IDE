import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  type BigIntStats
} from 'node:fs'
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname, join, parse, sep } from 'node:path'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import {
  isVerifiedClaudeManagedAccountProfile,
  type VerifiedClaudeManagedAccountProfile
} from '../../../claude-accounts/claude-managed-account-identity'
import type { ClaudeSessionProfileRoutingPin } from './claude-session-profile-routing-pin'

const PROFILE_POINTER_DIRECTORY = 'session-pins'
type FileIdentity = Readonly<{ device: bigint; inode: bigint }>

function isPrivateOwnedDirectory(stat: BigIntStats): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    (stat.mode & 0o077n) === 0n &&
    (!process.getuid || stat.uid === BigInt(process.getuid()))
  )
}

async function ensurePrivateDirectory(path: string): Promise<BigIntStats | null> {
  try {
    await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    })
    const stat = await lstat(path, { bigint: true })
    return isPrivateOwnedDirectory(stat) ? stat : null
  } catch {
    return null
  }
}

function samePathIdentity(stat: BigIntStats, identity: FileIdentity): boolean {
  return stat.dev === identity.device && stat.ino === identity.inode
}

/**
 * Synchronous pre-node-pty guard: no await may interleave a selector/profile
 * change with the native dispatch. This checks the original *physical* managed
 * profile, not only the expected string or the private pin's bytes.
 * It is not a defense against an adversarial process with the same OS uid.
 */
function assertVerifiedPhysicalProfileAtNativeDispatch(
  verified: VerifiedClaudeManagedAccountProfile
): void {
  if (!isVerifiedClaudeManagedAccountProfile(verified)) {
    throw new Error('claude_session_profile_routing_pin_identity_not_verified')
  }
  const home = verified.identity.home
  const root = parse(home).root
  let path = root
  for (const name of home.slice(root.length).split(sep).filter(Boolean)) {
    path = join(path, name)
    if (lstatSync(path, { bigint: true }).isSymbolicLink()) {
      throw new Error('claude_session_profile_routing_pin_profile_changed')
    }
  }
  const statHome = lstatSync(home, { bigint: true })
  if (
    !isPrivateOwnedDirectory(statHome) ||
    statHome.dev.toString() !== verified.identity.configHomeDevice ||
    statHome.ino.toString() !== verified.identity.configHomeInode
  ) {
    throw new Error('claude_session_profile_routing_pin_profile_changed')
  }
  const markerPath = join(dirname(home), 'profile.json')
  const markerFlags = constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0)
  const fd = openSync(markerPath, markerFlags)
  try {
    const marker = fstatSync(fd, { bigint: true })
    if (
      !marker.isFile() ||
      marker.nlink !== 1n ||
      (marker.mode & 0o077n) !== 0n ||
      (process.getuid && marker.uid !== BigInt(process.getuid())) ||
      marker.dev.toString() !== verified.ownershipMarker.device ||
      marker.ino.toString() !== verified.ownershipMarker.inode ||
      marker.size <= 0n ||
      marker.size > 512n
    ) {
      throw new Error('claude_session_profile_routing_pin_marker_changed')
    }
    const bytes = Buffer.alloc(513)
    const count = readSync(fd, bytes, 0, bytes.length, 0)
    const afterMarker = fstatSync(fd, { bigint: true })
    if (
      BigInt(count) !== marker.size ||
      afterMarker.size !== marker.size ||
      !samePathIdentity(afterMarker, { device: marker.dev, inode: marker.ino }) ||
      createHash('sha256').update(bytes.subarray(0, count)).digest('hex') !==
        verified.identity.ownershipMarkerSha256
    ) {
      throw new Error('claude_session_profile_routing_pin_marker_changed')
    }
  } finally {
    closeSync(fd)
  }
  const afterHome = lstatSync(home, { bigint: true })
  if (
    !isPrivateOwnedDirectory(afterHome) ||
    afterHome.dev !== statHome.dev ||
    afterHome.ino !== statHome.ino
  ) {
    throw new Error('claude_session_profile_routing_pin_profile_changed')
  }
}

function safelyUnlinkOwnedPin(
  path: string,
  directory: string,
  directoryIdentity: FileIdentity,
  fileIdentity: FileIdentity
): void {
  try {
    const directoryStat = lstatSync(directory, { bigint: true })
    if (
      !isPrivateOwnedDirectory(directoryStat) ||
      !samePathIdentity(directoryStat, directoryIdentity)
    ) {
      return
    }
    const fileStat = lstatSync(path, { bigint: true })
    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.nlink !== 1n ||
      (fileStat.mode & 0o077n) !== 0n ||
      (process.getuid && fileStat.uid !== BigInt(process.getuid())) ||
      !samePathIdentity(fileStat, fileIdentity)
    ) {
      return
    }
    unlinkSync(path)
  } catch {
    // An uncertain path or filesystem failure leaves the pin in place.
  }
}

function makePinLease(
  path: string,
  configHome: string,
  directory: string,
  directoryIdentity: FileIdentity,
  fileIdentity: FileIdentity,
  verifiedProfile: VerifiedClaudeManagedAccountProfile,
  pinFile: FileHandle
): ClaudeSessionProfileRoutingPin {
  let nativeSpawn: { ptyId: string; incarnationId: string } | null = null
  let nativeSpawnAttempted = false
  let nativeSpawnUncertain = false
  let finished = false
  let fileClosed = false
  const closePinFile = (): void => {
    if (fileClosed) {
      return
    }
    fileClosed = true
    void pinFile.close().catch(() => {})
  }
  const cleanup = (): void => {
    if (finished) {
      return
    }
    finished = true
    // Retain the original open inode until after unlink: otherwise unlink +
    // immediate replacement can recycle its dev/ino (observed on GitHub CI).
    // Closing first would let a foreign replacement pass our identity check.
    try {
      safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
    } finally {
      closePinFile()
    }
  }
  return Object.freeze({
    path,
    assertNativeSpawnEnvironment: (env) => {
      if (
        env.CLAUDE_CONFIG_DIR !== configHome ||
        env[CLAUDE_INJECTED_CONFIG_DIR_ENV] !== configHome ||
        env[CLAUDE_PROFILE_POINTER_ENV] !== path
      ) {
        throw new Error('claude_session_profile_routing_pin_environment_mismatch')
      }
      assertVerifiedPhysicalProfileAtNativeDispatch(verifiedProfile)
    },
    noteNativeSpawnAttempt: () => {
      if (!finished) {
        nativeSpawnAttempted = true
      }
    },
    noteNativeSpawnCallFailed: () => {
      if (!finished) {
        nativeSpawnUncertain = true
        // An ambiguous native dispatch forbids pin unlink even after a later
        // fallback exits. Keep the file itself, not an unused descriptor.
        closePinFile()
      }
    },
    noteNativeSpawnReturned: (ptyId, incarnationId) => {
      if (finished || nativeSpawn || !ptyId || !incarnationId) {
        return
      }
      nativeSpawn = { ptyId, incarnationId }
    },
    cleanupOnPtyExit: (ptyId, incarnationId) => {
      if (
        !nativeSpawnUncertain &&
        nativeSpawn?.ptyId === ptyId &&
        nativeSpawn.incarnationId === incarnationId
      ) {
        cleanup()
      }
    },
    cleanupIfUnspawned: () => {
      if (!nativeSpawn && !nativeSpawnAttempted) {
        cleanup()
      }
    }
  })
}

export async function createPrivatePointer(
  dataRoot: string,
  configHome: string,
  verifiedProfile: VerifiedClaudeManagedAccountProfile
): Promise<ClaudeSessionProfileRoutingPin | null> {
  const profilesDirectory = join(dataRoot, 'claude-profiles')
  const profilesStat = await lstat(profilesDirectory, { bigint: true }).catch(() => null)
  if (!profilesStat || !isPrivateOwnedDirectory(profilesStat)) {
    return null
  }
  const directory = join(profilesDirectory, PROFILE_POINTER_DIRECTORY)
  const directoryStat = await ensurePrivateDirectory(directory)
  if (!directoryStat) {
    return null
  }
  const directoryIdentity = Object.freeze({ device: directoryStat.dev, inode: directoryStat.ino })
  const noFollow = constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') {
    return null
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const path = join(directory, `${randomBytes(24).toString('hex')}.route`)
    let handle: FileHandle | undefined
    let fileIdentity: FileIdentity | null = null
    try {
      handle = await open(path, flags, 0o600)
      const opened = await handle.stat({ bigint: true })
      fileIdentity = Object.freeze({ device: opened.dev, inode: opened.ino })
      if (
        !opened.isFile() ||
        opened.nlink !== 1n ||
        (opened.mode & 0o077n) !== 0n ||
        (process.getuid && opened.uid !== BigInt(process.getuid()))
      ) {
        safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
        await handle.close()
        handle = undefined
        return null
      }
      await handle.writeFile(Buffer.from(`${configHome}\n`, 'utf8'))
      await handle.sync()
      // Hold this descriptor until the matching native PTY exits. An open
      // inode cannot be recycled by a rapid pathname replacement.
      const pathStat = await lstat(path, { bigint: true })
      if (
        !pathStat.isFile() ||
        pathStat.isSymbolicLink() ||
        pathStat.nlink !== 1n ||
        (pathStat.mode & 0o077n) !== 0n ||
        (process.getuid && pathStat.uid !== BigInt(process.getuid())) ||
        !samePathIdentity(pathStat, fileIdentity)
      ) {
        safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
        await handle.close()
        handle = undefined
        return null
      }
      const lease = makePinLease(
        path,
        configHome,
        directory,
        directoryIdentity,
        fileIdentity,
        verifiedProfile,
        handle
      )
      handle = undefined
      return lease
    } catch (error) {
      // If a descriptor is open, unlink before closing to prevent an ABA
      // reuse of its inode during cleanup of a partially issued pin.
      if (fileIdentity) {
        safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
      }
      await handle?.close().catch(() => {})
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      return null
    }
  }
  return null
}
