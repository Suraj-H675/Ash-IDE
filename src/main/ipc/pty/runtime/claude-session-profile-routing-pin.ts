import { randomBytes } from 'node:crypto'
import { constants, lstatSync, unlinkSync, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../../shared/app-environment'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  isVerifiedClaudeManagedAccountProfile,
  verifyClaudeManagedAccountProfileWithMarkerIdentity,
  type VerifiedClaudeManagedAccountProfile
} from '../../../claude-accounts/claude-managed-account-identity'
import {
  describeClaudeProfile,
  type ClaudeProfileDescriptor
} from '../../../claude-accounts/claude-profile-paths'
import { getSelectedClaudeAccountIdForTarget } from '../../../claude-accounts/runtime-selection'

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux'])
const PROFILE_POINTER_DIRECTORY = 'session-pins'

export type ClaudeManagedProfileRouteSelection = Readonly<{
  dataRoot: string
  accountId: string
  profile: ClaudeProfileDescriptor
  identityBeforePreparation: VerifiedClaudeManagedAccountProfile | null
}>

export type ClaudeSessionProfileRoutingPin = Readonly<{
  /** Opaque Ash-private file path; its contents are the prepared managed config home. */
  path: string
  /** Rejects any post-assembly environment change before native PTY dispatch. */
  assertNativeSpawnEnvironment(env: Readonly<Record<string, string>>): void
  /** A thrown native call is ambiguous, so cleanup must preserve the pin after this point. */
  noteNativeSpawnAttempt(): void
  noteNativeSpawnCallFailed(): void
  noteNativeSpawnReturned(ptyId: string, incarnationId: string): void
  cleanupOnPtyExit(ptyId: string, incarnationId: string): void
  cleanupIfUnspawned(): void
}>

type FileIdentity = Readonly<{ device: bigint; inode: bigint }>

function settingsAccountIsHostManaged(
  settings: GlobalSettings | undefined,
  accountId: string
): boolean {
  const account = settings?.claudeManagedAccounts?.find((entry) => entry.id === accountId)
  return Boolean(account && account.managedAuthRuntime !== 'wsl' && !account.wslDistro)
}

function dataRootFromHost(): string | null {
  try {
    return getAppEnvironment().getPath('userData')
  } catch {
    return null
  }
}

/** Snapshot the host's selected account before async auth preparation. Renderer values are not inputs. */
export async function captureClaudeManagedProfileRouteSelection(
  settings: GlobalSettings | undefined,
  platform: NodeJS.Platform = process.platform
): Promise<ClaudeManagedProfileRouteSelection | null> {
  if (!SUPPORTED_PLATFORMS.has(platform) || !settings) {
    return null
  }
  try {
    const accountId = getSelectedClaudeAccountIdForTarget(settings, { runtime: 'host' })
    if (!accountId || !settingsAccountIsHostManaged(settings, accountId)) {
      return null
    }
    const dataRoot = dataRootFromHost()
    if (!dataRoot) {
      return null
    }
    const profile = describeClaudeProfile(dataRoot, accountId, {
      executionHostId: 'local',
      runtime: 'host'
    })
    const identityBeforePreparation = await verifyClaudeManagedAccountProfileWithMarkerIdentity(
      dataRoot,
      profile
    ).catch(() => null)
    return Object.freeze({ dataRoot, accountId, profile, identityBeforePreparation })
  } catch {
    return null
  }
}

function sameProfileIdentity(
  left: VerifiedClaudeManagedAccountProfile,
  right: VerifiedClaudeManagedAccountProfile
): boolean {
  const a = left.identity
  const b = right.identity
  return (
    isVerifiedClaudeManagedAccountProfile(left) &&
    isVerifiedClaudeManagedAccountProfile(right) &&
    a.accountId === b.accountId &&
    a.home === b.home &&
    a.runtime === b.runtime &&
    a.hostPlatform === b.hostPlatform &&
    a.configHomeIdentity === b.configHomeIdentity &&
    a.configHomeDevice === b.configHomeDevice &&
    a.configHomeInode === b.configHomeInode &&
    a.ownershipMarkerSha256 === b.ownershipMarkerSha256 &&
    left.ownershipMarker.device === right.ownershipMarker.device &&
    left.ownershipMarker.inode === right.ownershipMarker.inode
  )
}

function hasProtectedEnvDeletion(envToDelete: readonly string[] | undefined): boolean {
  const protectedKeys = new Set([
    CLAUDE_PROFILE_POINTER_ENV,
    'CLAUDE_CONFIG_DIR',
    CLAUDE_INJECTED_CONFIG_DIR_ENV
  ])
  return (envToDelete ?? []).some((key) => protectedKeys.has(key))
}

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
  fileIdentity: FileIdentity
): ClaudeSessionProfileRoutingPin {
  let nativeSpawn: { ptyId: string; incarnationId: string } | null = null
  let nativeSpawnAttempted = false
  let nativeSpawnUncertain = false
  let finished = false
  const cleanup = (): void => {
    if (finished) {
      return
    }
    finished = true
    safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
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
    },
    noteNativeSpawnAttempt: () => {
      if (!finished) {
        nativeSpawnAttempted = true
      }
    },
    noteNativeSpawnCallFailed: () => {
      if (!finished) {
        nativeSpawnUncertain = true
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

async function createPrivatePointer(
  dataRoot: string,
  configHome: string
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
        await handle.close()
        handle = undefined
        safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
        return null
      }
      await handle.writeFile(Buffer.from(`${configHome}\n`, 'utf8'))
      await handle.sync()
      await handle.close()
      handle = undefined
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
        return null
      }
      return makePinLease(path, configHome, directory, directoryIdentity, fileIdentity)
    } catch (error) {
      await handle?.close().catch(() => {})
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      if (fileIdentity) {
        safelyUnlinkOwnedPin(path, directory, directoryIdentity, fileIdentity)
      }
      return null
    }
  }
  return null
}

/** Issue a pin only when independent host selection, marker identity, prepared auth, and final env agree. */
export async function createClaudeSessionProfileRoutingPin(args: {
  selection: ClaudeManagedProfileRouteSelection | null
  currentSettings: GlobalSettings | undefined
  auth: ClaudeRuntimeAuthPreparation | null
  nativeSpawnEnv: Readonly<Record<string, string>> | undefined
  callerEnvironmentOverride: boolean
  envToDelete?: readonly string[]
  platform?: NodeJS.Platform
}): Promise<ClaudeSessionProfileRoutingPin | null> {
  const selection = args.selection
  const platform = args.platform ?? process.platform
  if (
    !selection ||
    !SUPPORTED_PLATFORMS.has(platform) ||
    args.callerEnvironmentOverride ||
    hasProtectedEnvDeletion(args.envToDelete) ||
    !settingsAccountIsHostManaged(args.currentSettings, selection.accountId)
  ) {
    return null
  }
  const auth = args.auth
  const nativeSpawnEnv = args.nativeSpawnEnv
  if (!nativeSpawnEnv) {
    return null
  }
  const pointerPath = join(selection.dataRoot, 'claude-profiles', 'selected-host')
  const home = selection.profile.home
  if (
    !auth ||
    auth.runtime !== 'host' ||
    auth.configDir !== home ||
    auth.envPatch.CLAUDE_CONFIG_DIR !== home ||
    auth.envPatch[CLAUDE_INJECTED_CONFIG_DIR_ENV] !== home ||
    auth.envPatch[CLAUDE_PROFILE_POINTER_ENV] !== pointerPath ||
    nativeSpawnEnv.CLAUDE_CONFIG_DIR !== home ||
    nativeSpawnEnv[CLAUDE_INJECTED_CONFIG_DIR_ENV] !== home ||
    nativeSpawnEnv[CLAUDE_PROFILE_POINTER_ENV] !== pointerPath
  ) {
    return null
  }
  try {
    const currentIdentity = await verifyClaudeManagedAccountProfileWithMarkerIdentity(
      selection.dataRoot,
      selection.profile
    )
    const initialIdentity = selection.identityBeforePreparation
    if (
      !initialIdentity ||
      !isVerifiedClaudeManagedAccountProfile(currentIdentity) ||
      !isVerifiedClaudeManagedAccountProfile(initialIdentity) ||
      !sameProfileIdentity(initialIdentity, currentIdentity)
    ) {
      return null
    }
    return await createPrivatePointer(selection.dataRoot, home)
  } catch {
    return null
  }
}
