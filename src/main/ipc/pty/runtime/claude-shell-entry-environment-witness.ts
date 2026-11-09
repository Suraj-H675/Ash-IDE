import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats
} from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { CLAUDE_PROFILE_POINTER_ENV } from '../../../../shared/claude-profile-routing'
import { getSelectedClaudeAccountIdForTarget } from '../../../claude-accounts/runtime-selection'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import type {
  LocalPtyShellEntryAttempt,
  LocalPtyShellEntryObserver
} from '../../../providers/local-pty/local-pty-shell-entry-observer'

type Fingerprint =
  | Readonly<{ status: 'available'; sha256: string }>
  | Readonly<{ status: 'missing' }>

type PointerSnapshot =
  | Readonly<{
      status: 'available'
      pathSha256: string
      valueSha256: string
    }>
  | Readonly<{ status: 'unavailable' }>

export type ClaudeShellEntryLaunchContext = Readonly<{
  callerEnvironmentOverride: boolean
  expectedConfigDirSha256: string | null
  inheritedConfigDirSha256: string | null
  preparedPointerPathSha256: string | null
  selectionBeforePreparation: Fingerprint
  selectionAfterPreparation: Fingerprint
  pointerBeforePreparation: PointerSnapshot
  pointerAfterPreparation: PointerSnapshot
}>

export type ClaudeShellEntryEnvironmentWitness = Readonly<{
  kind: 'consistency-only'
  ptyId: string
  incarnationId: string
  nativeSpawnAttempt: LocalPtyShellEntryAttempt
  configDirStatus: 'missing' | 'empty' | 'set' | 'ambiguous'
  configDirPathSha256: string | null
  configDirSource: 'none' | 'prepared' | 'inherited' | 'other' | 'caller-override'
  comparison:
    | 'matched'
    | 'mismatched'
    | 'missing'
    | 'empty'
    | 'unavailable'
    | 'refused-caller-override'
    | 'refused-selection-change'
    | 'refused-pointer-change'
  selector: 'stable' | 'changed' | 'unavailable'
  selectedHostPointer: 'stable' | 'changed' | 'unavailable'
  accountEvidence: Readonly<{
    status: 'missing'
    reason: 'no-independent-private-marker-verified-profile-binding'
  }>
}>

type RuntimeSettingsReader = (() => GlobalSettings | undefined) | undefined

type RuntimeSnapshot = Readonly<{
  selector: Fingerprint
  pointer: PointerSnapshot
}>

type EntryEnv = Readonly<Record<string, string>>

type PendingNativeAttempt = Readonly<{
  ptyId: string
  incarnationId: string
  attempt: LocalPtyShellEntryAttempt
  configDirStatus: 'missing' | 'empty' | 'set' | 'ambiguous'
  configDirSha256: string | null
  pointerEnvPathSha256: string | null
  pointerEnvAmbiguous: boolean
  runtime: RuntimeSnapshot
}>

type EnvironmentValue = Readonly<{
  status: 'missing' | 'empty' | 'set' | 'ambiguous'
  value: string | null
}>

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function samePointerFileVersion(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function readBoundedPointerDescriptor(descriptor: number): Buffer | null {
  const buffer = Buffer.alloc(8193)
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead)
    if (count === 0) {
      break
    }
    bytesRead += count
  }
  return bytesRead > 8192 ? null : buffer.subarray(0, bytesRead)
}

function readSelection(getSettings: RuntimeSettingsReader): Fingerprint {
  try {
    const settings = getSettings?.()
    if (!settings) {
      return Object.freeze({ status: 'missing' })
    }
    const accountId = getSelectedClaudeAccountIdForTarget(settings, { runtime: 'host' })
    return Object.freeze({
      status: 'available',
      sha256: sha256(accountId === null ? '<system-default>' : `managed:${accountId}`)
    })
  } catch {
    return Object.freeze({ status: 'missing' })
  }
}

function selectedHostPointerPath(): string | null {
  try {
    return join(getAppEnvironment().getPath('userData'), 'claude-profiles', 'selected-host')
  } catch {
    return null
  }
}

function readSelectedHostPointer(): PointerSnapshot {
  const path = selectedHostPointerPath()
  if (!path) {
    return Object.freeze({ status: 'unavailable' })
  }
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > 8192) {
      return Object.freeze({ status: 'unavailable' })
    }
    const flags =
      fsConstants.O_RDONLY |
      (fsConstants.O_NONBLOCK ?? 0) |
      (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    const descriptor = openSync(path, flags)
    try {
      const opened = fstatSync(descriptor)
      if (
        !opened.isFile() ||
        opened.dev !== stat.dev ||
        opened.ino !== stat.ino ||
        opened.size > 8192
      ) {
        return Object.freeze({ status: 'unavailable' })
      }
      const firstRead = readBoundedPointerDescriptor(descriptor)
      const afterFirstRead = fstatSync(descriptor)
      const secondRead = readBoundedPointerDescriptor(descriptor)
      const afterSecondRead = fstatSync(descriptor)
      if (
        !firstRead ||
        !secondRead ||
        firstRead.length !== opened.size ||
        secondRead.length !== opened.size ||
        !firstRead.equals(secondRead) ||
        !samePointerFileVersion(opened, afterFirstRead) ||
        !samePointerFileVersion(afterFirstRead, afterSecondRead)
      ) {
        return Object.freeze({ status: 'unavailable' })
      }
      return Object.freeze({
        status: 'available',
        pathSha256: sha256(path),
        valueSha256: sha256(secondRead)
      })
    } finally {
      closeSync(descriptor)
    }
  } catch {
    return Object.freeze({ status: 'unavailable' })
  }
}

function snapshotRuntime(getSettings: RuntimeSettingsReader): RuntimeSnapshot {
  return Object.freeze({
    selector: readSelection(getSettings),
    pointer: readSelectedHostPointer()
  })
}

export function beginClaudeShellEntryEnvironmentSnapshot(
  getSettings: RuntimeSettingsReader
): RuntimeSnapshot {
  return snapshotRuntime(getSettings)
}

function readEnvironmentValue(
  env: Readonly<Record<string, string>>,
  key: string,
  platform: NodeJS.Platform
): EnvironmentValue {
  const matchingKeys =
    platform === 'win32'
      ? Object.keys(env).filter((candidate) => candidate.toUpperCase() === key.toUpperCase())
      : Object.hasOwn(env, key)
        ? [key]
        : []
  if (matchingKeys.length > 1) {
    return Object.freeze({ status: 'ambiguous', value: null })
  }
  const matchingKey = matchingKeys[0]
  if (matchingKey === undefined) {
    return Object.freeze({ status: 'missing', value: null })
  }
  const value = env[matchingKey]
  return Object.freeze({ status: value.length === 0 ? 'empty' : 'set', value })
}

export function hasCallerClaudeShellEnvironmentOverride(
  args: {
    env?: Record<string, string>
    launchConfig?: { agentEnv?: Record<string, string> }
  },
  platform: NodeJS.Platform = process.platform
): boolean {
  const overriddenKeys = ['CLAUDE_CONFIG_DIR', CLAUDE_PROFILE_POINTER_ENV]
  const hasKey = (env: Readonly<Record<string, string>>, key: string): boolean =>
    platform === 'win32'
      ? Object.keys(env).some((candidate) => candidate.toUpperCase() === key.toUpperCase())
      : Object.hasOwn(env, key)
  return overriddenKeys.some(
    (key) => hasKey(args.env ?? {}, key) || hasKey(args.launchConfig?.agentEnv ?? {}, key)
  )
}

export function prepareClaudeShellEntryEnvironmentWitness(args: {
  before: RuntimeSnapshot
  after: RuntimeSnapshot
  auth: ClaudeRuntimeAuthPreparation | null
  callerEnvironmentOverride: boolean
}): ClaudeShellEntryLaunchContext {
  const pointerPath = args.auth?.envPatch[CLAUDE_PROFILE_POINTER_ENV]
  return Object.freeze({
    callerEnvironmentOverride: args.callerEnvironmentOverride,
    expectedConfigDirSha256: args.auth?.configDir ? sha256(args.auth.configDir) : null,
    inheritedConfigDirSha256: process.env.CLAUDE_CONFIG_DIR
      ? sha256(process.env.CLAUDE_CONFIG_DIR)
      : null,
    preparedPointerPathSha256: pointerPath ? sha256(pointerPath) : null,
    selectionBeforePreparation: args.before.selector,
    selectionAfterPreparation: args.after.selector,
    pointerBeforePreparation: args.before.pointer,
    pointerAfterPreparation: args.after.pointer
  })
}

function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean | null {
  if (left.status !== 'available' || right.status !== 'available') {
    return null
  }
  return left.sha256 === right.sha256
}

function samePointer(left: PointerSnapshot, right: PointerSnapshot): boolean | null {
  if (left.status !== 'available' || right.status !== 'available') {
    return null
  }
  return left.pathSha256 === right.pathSha256 && left.valueSha256 === right.valueSha256
}

function stableSelector(
  context: ClaudeShellEntryLaunchContext,
  before: RuntimeSnapshot,
  after: RuntimeSnapshot
): 'stable' | 'changed' | 'unavailable' {
  const prepared = sameFingerprint(
    context.selectionBeforePreparation,
    context.selectionAfterPreparation
  )
  const beforeSpawn = sameFingerprint(context.selectionAfterPreparation, before.selector)
  const afterSpawn = sameFingerprint(context.selectionAfterPreparation, after.selector)
  const spawnInterval = sameFingerprint(before.selector, after.selector)
  if (
    prepared === false ||
    beforeSpawn === false ||
    afterSpawn === false ||
    spawnInterval === false
  ) {
    return 'changed'
  }
  return prepared === true && beforeSpawn === true && afterSpawn === true && spawnInterval === true
    ? 'stable'
    : 'unavailable'
}

function stablePointer(
  context: ClaudeShellEntryLaunchContext,
  before: PendingNativeAttempt,
  after: PendingNativeAttempt
): 'stable' | 'changed' | 'unavailable' {
  if (before.pointerEnvAmbiguous || after.pointerEnvAmbiguous) {
    return 'unavailable'
  }
  const prepared = samePointer(context.pointerBeforePreparation, context.pointerAfterPreparation)
  const beforeSpawn = samePointer(context.pointerAfterPreparation, before.runtime.pointer)
  const afterSpawn = samePointer(context.pointerAfterPreparation, after.runtime.pointer)
  const spawnInterval = samePointer(before.runtime.pointer, after.runtime.pointer)
  if (
    prepared === false ||
    beforeSpawn === false ||
    afterSpawn === false ||
    spawnInterval === false ||
    (context.preparedPointerPathSha256 !== null &&
      (before.pointerEnvPathSha256 !== context.preparedPointerPathSha256 ||
        after.pointerEnvPathSha256 !== context.preparedPointerPathSha256)) ||
    (context.pointerAfterPreparation.status === 'available' &&
      context.preparedPointerPathSha256 !== context.pointerAfterPreparation.pathSha256)
  ) {
    return 'changed'
  }
  return prepared === true && beforeSpawn === true && afterSpawn === true && spawnInterval === true
    ? 'stable'
    : 'unavailable'
}

function captureAttempt(args: {
  ptyId: string
  incarnationId: string
  attempt: LocalPtyShellEntryAttempt
  env: EntryEnv
  getSettings: RuntimeSettingsReader
  platform: NodeJS.Platform
}): PendingNativeAttempt {
  const configDir = readEnvironmentValue(args.env, 'CLAUDE_CONFIG_DIR', args.platform)
  const pointerEnv = readEnvironmentValue(args.env, CLAUDE_PROFILE_POINTER_ENV, args.platform)
  return Object.freeze({
    ptyId: args.ptyId,
    incarnationId: args.incarnationId,
    attempt: args.attempt,
    configDirStatus: configDir.status,
    configDirSha256: configDir.status === 'set' && configDir.value ? sha256(configDir.value) : null,
    pointerEnvPathSha256:
      pointerEnv.status === 'set' && pointerEnv.value ? sha256(pointerEnv.value) : null,
    pointerEnvAmbiguous: pointerEnv.status === 'ambiguous',
    runtime: snapshotRuntime(args.getSettings)
  })
}

function makeWitness(
  context: ClaudeShellEntryLaunchContext,
  before: PendingNativeAttempt,
  after: PendingNativeAttempt
): ClaudeShellEntryEnvironmentWitness {
  const selector = stableSelector(context, before.runtime, after.runtime)
  const selectedHostPointer = stablePointer(context, before, after)
  const configDirSource = context.callerEnvironmentOverride
    ? 'caller-override'
    : after.configDirSha256 !== null && after.configDirSha256 === context.expectedConfigDirSha256
      ? 'prepared'
      : after.configDirSha256 !== null && after.configDirSha256 === context.inheritedConfigDirSha256
        ? 'inherited'
        : after.configDirStatus === 'missing' || after.configDirStatus === 'empty'
          ? 'none'
          : 'other'
  let comparison: ClaudeShellEntryEnvironmentWitness['comparison']
  if (context.callerEnvironmentOverride) {
    comparison = 'refused-caller-override'
  } else if (selector === 'changed') {
    comparison = 'refused-selection-change'
  } else if (selectedHostPointer === 'changed') {
    comparison = 'refused-pointer-change'
  } else if (selector === 'unavailable' || selectedHostPointer === 'unavailable') {
    comparison = 'unavailable'
  } else if (after.configDirStatus === 'missing') {
    comparison = 'missing'
  } else if (after.configDirStatus === 'empty') {
    comparison = 'empty'
  } else if (after.configDirStatus === 'ambiguous') {
    comparison = 'unavailable'
  } else if (!context.expectedConfigDirSha256) {
    comparison = 'unavailable'
  } else {
    comparison =
      after.configDirSha256 === context.expectedConfigDirSha256 ? 'matched' : 'mismatched'
  }
  // A before/after PTY identity or env change makes the observation unusable.
  if (
    before.ptyId !== after.ptyId ||
    before.incarnationId !== after.incarnationId ||
    before.attempt !== after.attempt ||
    before.configDirStatus !== after.configDirStatus ||
    before.configDirSha256 !== after.configDirSha256
  ) {
    comparison = 'unavailable'
  }
  return Object.freeze({
    kind: 'consistency-only',
    ptyId: after.ptyId,
    incarnationId: after.incarnationId,
    nativeSpawnAttempt: after.attempt,
    configDirStatus: after.configDirStatus,
    configDirPathSha256: after.configDirSha256,
    configDirSource,
    comparison,
    selector,
    selectedHostPointer,
    accountEvidence: Object.freeze({
      status: 'missing',
      reason: 'no-independent-private-marker-verified-profile-binding'
    })
  })
}

export function createClaudeShellEntryEnvironmentObserver(
  context: ClaudeShellEntryLaunchContext,
  getSettings: RuntimeSettingsReader,
  platform: NodeJS.Platform = process.platform
): { observer: LocalPtyShellEntryObserver; read: () => ClaudeShellEntryEnvironmentWitness | null } {
  let pending: PendingNativeAttempt | null = null
  let witness: ClaudeShellEntryEnvironmentWitness | null = null
  const observer: LocalPtyShellEntryObserver = (args) => {
    const snapshot = captureAttempt({ ...args, getSettings, platform })
    if (args.phase === 'before') {
      pending = snapshot
      return
    }
    if (pending) {
      witness = makeWitness(context, pending, snapshot)
      pending = null
    }
  }
  return { observer, read: () => witness }
}
