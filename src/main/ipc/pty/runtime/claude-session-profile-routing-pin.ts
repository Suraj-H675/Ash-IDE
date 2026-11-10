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
import { createPrivatePointer } from './claude-session-profile-routing-pin-storage'

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux'])

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

export type ClaudeConfigRouteOnlyEvidence = Readonly<{
  status: 'config-route-only'
  accountId: string
  configHome: string
  configHomeIdentity: string
  configHomeDevice: string
  configHomeInode: string
}>

type NativeSpawnReceipt = {
  attempted: boolean
  uncertain: boolean
  returned: Readonly<{ ptyId: string; incarnationId: string }> | null
  finished: boolean
}

const committedRouteByPin = new WeakMap<
  object,
  { evidence: ClaudeConfigRouteOnlyEvidence; nativeSpawn: NativeSpawnReceipt }
>()

/** Read route facts only from a verified pin whose native PTY callback returned this generation. */
export function readCommittedClaudeConfigRouteEvidence(
  pin: unknown,
  ptyId: string,
  incarnationId: string
): ClaudeConfigRouteOnlyEvidence | null {
  if (typeof pin !== 'object' || pin === null) {
    return null
  }
  const receipt = committedRouteByPin.get(pin)
  if (
    !receipt ||
    !receipt.nativeSpawn.attempted ||
    receipt.nativeSpawn.uncertain ||
    receipt.nativeSpawn.finished ||
    receipt.nativeSpawn.returned?.ptyId !== ptyId ||
    receipt.nativeSpawn.returned.incarnationId !== incarnationId
  ) {
    return null
  }
  return receipt.evidence
}

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
    auth?.runtime !== 'host' ||
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
    const privatePointer = await createPrivatePointer(selection.dataRoot, home, currentIdentity)
    if (!privatePointer) {
      return null
    }
    const routeIdentity = currentIdentity.identity
    const evidence: ClaudeConfigRouteOnlyEvidence = Object.freeze({
      status: 'config-route-only',
      accountId: routeIdentity.accountId,
      configHome: routeIdentity.home,
      configHomeIdentity: routeIdentity.configHomeIdentity,
      configHomeDevice: routeIdentity.configHomeDevice,
      configHomeInode: routeIdentity.configHomeInode
    })
    const nativeSpawn: NativeSpawnReceipt = {
      attempted: false,
      uncertain: false,
      returned: null,
      finished: false
    }
    const pin: ClaudeSessionProfileRoutingPin = Object.freeze({
      path: privatePointer.path,
      assertNativeSpawnEnvironment: (env) => privatePointer.assertNativeSpawnEnvironment(env),
      noteNativeSpawnAttempt: () => {
        if (!nativeSpawn.finished) {
          nativeSpawn.attempted = true
          privatePointer.noteNativeSpawnAttempt()
        }
      },
      noteNativeSpawnCallFailed: () => {
        if (!nativeSpawn.finished) {
          nativeSpawn.uncertain = true
          privatePointer.noteNativeSpawnCallFailed()
        }
      },
      noteNativeSpawnReturned: (ptyId, incarnationId) => {
        if (
          !nativeSpawn.finished &&
          !nativeSpawn.returned &&
          ptyId.length > 0 &&
          incarnationId.length > 0
        ) {
          nativeSpawn.returned = Object.freeze({ ptyId, incarnationId })
          privatePointer.noteNativeSpawnReturned(ptyId, incarnationId)
        }
      },
      cleanupOnPtyExit: (ptyId, incarnationId) => {
        if (
          !nativeSpawn.uncertain &&
          nativeSpawn.returned?.ptyId === ptyId &&
          nativeSpawn.returned.incarnationId === incarnationId
        ) {
          nativeSpawn.finished = true
        }
        privatePointer.cleanupOnPtyExit(ptyId, incarnationId)
      },
      cleanupIfUnspawned: () => {
        if (!nativeSpawn.attempted && !nativeSpawn.returned) {
          nativeSpawn.finished = true
        }
        privatePointer.cleanupIfUnspawned()
      }
    })
    committedRouteByPin.set(pin, { evidence, nativeSpawn })
    return pin
  } catch {
    return null
  }
}
