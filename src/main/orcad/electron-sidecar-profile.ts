import { randomBytes } from 'node:crypto'
import { renameSync, rmSync, rmdirSync, unlinkSync } from 'node:fs'
import { lstat, mkdtemp, open } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { spawnProcess } from '@orca/process-host'
import type { ChildProcessHandle as ChildProcess } from '@orca/process-host/process-spec'
import { forceTerminateProcessTree } from '@orca/process-host/process-tree-termination'
import { BROWSER_SIDECAR_OWNER_ENV } from '../../shared/browser-sidecar-lifetime'
import { electronIsolatedProfileSwitches } from '../../shared/electron-isolated-profile-switches'
import { headlessServeOzonePlatformSwitches } from '../../shared/headless-serve-ozone-platform'
import { electronServeEnvironment } from './electron-serve-browser-environment'
import { isSafeOwnedDirectory } from '../../shared/owned-private-directory'
import { bestEffortFsyncDirectorySync, writeDurableSecureJsonFile } from '../../shared/secure-file'
import { readPrivateWindowsFile } from '../../shared/secure-path-windows-acl'
import { isProcessAlive } from '../../shared/serve-bundle-coordination'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { isDirectChild } from '../window/owned-temp-staging-root'
import { readSidecarProfileUse } from './electron-sidecar-profile-process-evidence'

const STOP_TIMEOUT_MS = 5_000
const requestedDisconnects = new WeakSet<ChildProcess>()
const PROFILE_PREFIX = 'orcad-browser-'
const PROFILE_GC_PREFIX = 'orcad-browser-gc-'
// Lives in orcad's private data root, so only this instance can name a profile for removal.
const PROFILE_RECORD_FILE = 'browser-sidecar-profile.json'
const PROFILE_GC_RECORD_FILE = 'browser-sidecar-profile-gc.json'
const MAX_PROFILE_RECORD_BYTES = 4_096
const ProfileRecord = z
  .object({ profilePath: z.string(), sidecarExecutableName: z.string().optional() })
  .passthrough()
const ProfileGcRecord = z
  .object({
    profilePath: z.string(),
    ownerRecordDevice: z.number().finite(),
    ownerRecordInode: z.number().finite(),
    ownerRecordSize: z.number().finite(),
    ownerRecordMtimeMs: z.number().finite(),
    profileDevice: z.number().finite(),
    profileInode: z.number().finite(),
    quarantineRootPath: z.string(),
    quarantinePath: z.string(),
    quarantineDevice: z.number().finite(),
    quarantineInode: z.number().finite()
  })
  .strict()

type RecordedProfile =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | {
      kind: 'valid'
      profilePath: string
      sidecarExecutableName?: string
      recordStats: Stats
    }

type ReadSecureRecord =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: unknown; recordStats: Stats }

type RecordedProfileGc =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: z.infer<typeof ProfileGcRecord>; recordStats: Stats }

type ProfileCleanupAuthority = 'orphan-recovery' | 'owned-child-exited' | 'not-spawned'
type ProfileCleanupOperations = {
  renameProfile: (sourcePath: string, quarantinePath: string) => void
  removeTree: (profilePath: string) => Promise<void>
}
const profileCleanupOperations: ProfileCleanupOperations = {
  renameProfile: renameSync,
  removeTree
}

// Short /tmp, not macOS's long tmpdir(): the sidecar binds its runtime socket in its profile.
function temporaryRoot(): string {
  return process.platform === 'win32' ? tmpdir() : '/tmp'
}

function publishSecureJsonRecord(recordPath: string, value: unknown): boolean {
  const stagedRecordPath = `${recordPath}.${process.pid}.${randomBytes(8).toString('hex')}.staging`
  let published = false
  try {
    if (!writeDurableSecureJsonFile(stagedRecordPath, value)) {
      return false
    }
    renameSync(stagedRecordPath, recordPath)
    published = true
    bestEffortFsyncDirectorySync(dirname(recordPath))
    return true
  } finally {
    if (!published) {
      rmSync(stagedRecordPath, { force: true })
    }
  }
}

export function spawnElectronSidecar(
  executablePath: string,
  userDataPath: string,
  port: number
): ChildProcess {
  return spawnProcess({
    program: executablePath,
    args: [
      '--serve',
      '--serve-port',
      String(port),
      '--serve-json',
      '--serve-no-pairing',
      ...electronIsolatedProfileSwitches(process.env),
      ...headlessServeOzonePlatformSwitches(process.platform),
      `--user-data-dir=${userDataPath}`
    ],
    env: { ...electronServeEnvironment(userDataPath), [BROWSER_SIDECAR_OWNER_ENV]: '1' },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
    detached: process.platform !== 'win32'
  })
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childHasExited(child)) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(exited || childHasExited(child))
    }
    const onExit = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    child.once('exit', onExit)
    // Close the gap between the first state check and listener registration.
    if (childHasExited(child)) {
      finish(true)
    }
  })
}

function signalOwnedChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || childHasExited(child)) {
    return
  }
  try {
    child.kill(signal)
  } catch {
    // Exit confirmation below, not the signal result, determines cleanup success.
  }
}

/** Stop only the ChildProcess created by this provider, and require its exit event/state. */
export async function stopElectronSidecar(
  child: ChildProcess
): Promise<'confirmed' | 'unresolved'> {
  if (!child.pid) {
    return 'confirmed'
  }
  if (childHasExited(child)) {
    if (process.platform === 'win32') {
      return requestedDisconnects.has(child) ? 'confirmed' : 'unresolved'
    }
    return typeof child.spawnfile === 'string' && (await forceTerminateProcessTree(child))
      ? 'confirmed'
      : 'unresolved'
  }
  let disconnected = false
  if (child.connected) {
    try {
      child.disconnect()
      requestedDisconnects.add(child)
      disconnected = true
    } catch {
      // Fall back to the owned process handle below.
    }
  }
  if (!disconnected) {
    if (process.platform === 'win32') {
      return (await forceTerminateProcessTree(child)) ? 'confirmed' : 'unresolved'
    }
    signalOwnedChild(child, 'SIGTERM')
  }
  if (await waitForChildExit(child, STOP_TIMEOUT_MS)) {
    if (process.platform === 'win32') {
      return disconnected ? 'confirmed' : 'unresolved'
    }
    return (await forceTerminateProcessTree(child)) ? 'confirmed' : 'unresolved'
  }
  if (typeof child.spawnfile !== 'string' || !child.spawnfile) {
    return 'unresolved'
  }
  if (!(await forceTerminateProcessTree(child))) {
    return 'unresolved'
  }
  return (await waitForChildExit(child, STOP_TIMEOUT_MS)) ? 'confirmed' : 'unresolved'
}

function isSafePid(pid: number | null | undefined): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0
}

export function electronSidecarIsAvailable(
  child: ChildProcess | null,
  runtimePid: number | null
): boolean {
  if (!isSafePid(runtimePid)) {
    return false
  }
  if (child?.pid === runtimePid) {
    return child.exitCode === null && child.signalCode === null
  }
  // A mismatched or untracked PID is only a conservative positive signal.
  return isProcessAlive(runtimePid)
}

export function electronSidecarPid(
  child: ChildProcess | null,
  runtimePid: number | null
): number | null {
  return isSafePid(runtimePid) &&
    isSafePid(child?.pid) &&
    child.pid === runtimePid &&
    child.exitCode === null &&
    child.signalCode === null
    ? child.pid
    : null
}

/** Unpredictable per start, so no other account can claim the name first. */
export async function createElectronSidecarProfile(
  orcadUserDataPath: string,
  executablePath?: string
): Promise<string> {
  const profilePath = await mkdtemp(join(temporaryRoot(), PROFILE_PREFIX))
  const profileStats = await lstat(profilePath)
  try {
    const recordPath = join(orcadUserDataPath, PROFILE_RECORD_FILE)
    if (
      !publishSecureJsonRecord(recordPath, {
        profilePath,
        ...(executablePath ? { sidecarExecutableName: basename(executablePath) } : {})
      })
    ) {
      throw new Error(
        'Could not verify private permissions on the Electron browser profile record.'
      )
    }
  } catch (error) {
    const current = await lstatProfile(profilePath)
    const owner = await readRecordedProfile(orcadUserDataPath)
    if (
      current.kind === 'present' &&
      isSafeOwnedDirectory(current.stats) &&
      sameDirectoryIdentity(profileStats, current.stats) &&
      (owner.kind === 'missing' || (owner.kind === 'valid' && owner.profilePath !== profilePath))
    ) {
      // A record-write failure is pre-spawn. Remove only the original empty allocation;
      // rmdir preserves unexpected contents and cannot recursively erase a path replacement.
      try {
        rmdirSync(profilePath)
      } catch {
        // Keep the unrecorded directory if it is no longer empty or cannot be removed safely.
      }
    }
    throw error
  }
  return profilePath
}

function isPrivateRegularFile(stats: Stats): boolean {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return false
  }
  return (
    process.platform === 'win32' ||
    ((typeof process.getuid !== 'function' || stats.uid === process.getuid()) &&
      (stats.mode & 0o077) === 0 &&
      (stats.mode & 0o600) === 0o600)
  )
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  )
}

function sameDirectoryIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function hasDirectoryIdentity(stats: Stats, device: number, inode: number): boolean {
  return stats.dev === device && stats.ino === inode
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function lstatProfile(
  profilePath: string
): Promise<{ kind: 'missing' } | { kind: 'unknown' } | { kind: 'present'; stats: Stats }> {
  try {
    return { kind: 'present', stats: await lstat(profilePath) }
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : { kind: 'unknown' }
  }
}

async function readSecureJsonRecord(recordPath: string): Promise<ReadSecureRecord> {
  let before: Stats
  try {
    before = await lstat(recordPath)
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' }
  }
  if (!isPrivateRegularFile(before) || before.size > MAX_PROFILE_RECORD_BYTES) {
    return { kind: 'invalid' }
  }

  let file
  try {
    file = await open(recordPath, 'r')
    const opened = await file.stat()
    if (!isPrivateRegularFile(opened) || !sameFileSnapshot(before, opened)) {
      return { kind: 'invalid' }
    }
    const buffer = Buffer.alloc(MAX_PROFILE_RECORD_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_PROFILE_RECORD_BYTES) {
      return { kind: 'invalid' }
    }
    if (process.platform === 'win32') {
      const protectedContent = readPrivateWindowsFile(recordPath, MAX_PROFILE_RECORD_BYTES)
      if (!protectedContent || !protectedContent.equals(buffer.subarray(0, bytesRead))) {
        return { kind: 'invalid' }
      }
    }
    const afterOpenRead = await file.stat()
    const afterPathRead = await lstat(recordPath)
    if (
      !sameFileSnapshot(opened, afterOpenRead) ||
      !sameFileSnapshot(afterOpenRead, afterPathRead) ||
      !isPrivateRegularFile(afterPathRead)
    ) {
      return { kind: 'invalid' }
    }
    return {
      kind: 'valid',
      value: JSON.parse(buffer.toString('utf8', 0, bytesRead)),
      recordStats: afterPathRead
    }
  } catch (error) {
    return { kind: 'invalid' }
  } finally {
    await file?.close().catch(() => undefined)
  }
}

async function readRecordedProfile(orcadUserDataPath: string): Promise<RecordedProfile> {
  const stored = await readSecureJsonRecord(join(orcadUserDataPath, PROFILE_RECORD_FILE))
  if (stored.kind !== 'valid') {
    return stored
  }
  const parsed = ProfileRecord.safeParse(stored.value)
  if (!parsed.success) {
    return { kind: 'invalid' }
  }
  const { profilePath, sidecarExecutableName } = parsed.data
  if (
    !isDirectChild(temporaryRoot(), profilePath) ||
    !basename(profilePath).startsWith(PROFILE_PREFIX) ||
    (sidecarExecutableName !== undefined &&
      (!sidecarExecutableName || basename(sidecarExecutableName) !== sidecarExecutableName))
  ) {
    return { kind: 'invalid' }
  }
  return {
    kind: 'valid',
    profilePath,
    recordStats: stored.recordStats,
    ...(sidecarExecutableName ? { sidecarExecutableName } : {})
  }
}

async function readRecordedProfileGc(orcadUserDataPath: string): Promise<RecordedProfileGc> {
  const stored = await readSecureJsonRecord(join(orcadUserDataPath, PROFILE_GC_RECORD_FILE))
  if (stored.kind !== 'valid') {
    return stored
  }
  const parsed = ProfileGcRecord.safeParse(stored.value)
  if (!parsed.success) {
    return { kind: 'invalid' }
  }
  const value = parsed.data
  if (
    !isDirectChild(temporaryRoot(), value.profilePath) ||
    !basename(value.profilePath).startsWith(PROFILE_PREFIX) ||
    !isDirectChild(temporaryRoot(), value.quarantineRootPath) ||
    !basename(value.quarantineRootPath).startsWith(PROFILE_GC_PREFIX) ||
    value.quarantinePath !== join(value.quarantineRootPath, 'profile') ||
    ![
      value.ownerRecordDevice,
      value.ownerRecordInode,
      value.profileDevice,
      value.profileInode,
      value.quarantineDevice,
      value.quarantineInode
    ].every(Number.isSafeInteger) ||
    value.ownerRecordSize < 0 ||
    value.ownerRecordMtimeMs < 0
  ) {
    return { kind: 'invalid' }
  }
  return { kind: 'valid', value, recordStats: stored.recordStats }
}

async function recordedProfileIsUnchanged(
  orcadUserDataPath: string,
  recordStats: Stats
): Promise<boolean> {
  try {
    const current = await lstat(join(orcadUserDataPath, PROFILE_RECORD_FILE))
    return isPrivateRegularFile(current) && sameFileSnapshot(recordStats, current)
  } catch {
    return false
  }
}

async function recordedProfileGcIsUnchanged(
  orcadUserDataPath: string,
  recordStats: Stats
): Promise<boolean> {
  try {
    const current = await lstat(join(orcadUserDataPath, PROFILE_GC_RECORD_FILE))
    return isPrivateRegularFile(current) && sameFileSnapshot(recordStats, current)
  } catch {
    return false
  }
}

function gcMatchesOwner(
  gc: z.infer<typeof ProfileGcRecord>,
  owner: Extract<RecordedProfile, { kind: 'valid' }>
): boolean {
  return (
    gc.profilePath === owner.profilePath &&
    gc.ownerRecordDevice === owner.recordStats.dev &&
    gc.ownerRecordInode === owner.recordStats.ino &&
    gc.ownerRecordSize === owner.recordStats.size &&
    gc.ownerRecordMtimeMs === owner.recordStats.mtimeMs
  )
}

async function removeRecordedProfileGc(
  orcadUserDataPath: string,
  gcRecord: Extract<RecordedProfileGc, { kind: 'valid' }>,
  owner: Extract<RecordedProfile, { kind: 'valid' }>,
  operations: ProfileCleanupOperations
): Promise<boolean> {
  if (
    !gcMatchesOwner(gcRecord.value, owner) ||
    !(await recordedProfileIsUnchanged(orcadUserDataPath, owner.recordStats)) ||
    !(await recordedProfileGcIsUnchanged(orcadUserDataPath, gcRecord.recordStats))
  ) {
    return false
  }

  const value = gcRecord.value
  let quarantineRoot = await lstatProfile(value.quarantineRootPath)
  if (quarantineRoot.kind === 'missing') {
    const source = await lstatProfile(value.profilePath)
    if (source.kind === 'missing') {
      // A crash may land after recursive removal and before intent unlink.
      if (
        !(await recordedProfileIsUnchanged(orcadUserDataPath, owner.recordStats)) ||
        !(await recordedProfileGcIsUnchanged(orcadUserDataPath, gcRecord.recordStats))
      ) {
        return false
      }
      try {
        unlinkSync(join(orcadUserDataPath, PROFILE_GC_RECORD_FILE))
        return true
      } catch {
        return false
      }
    }
    if (
      source.kind !== 'present' ||
      !isSafeOwnedDirectory(source.stats) ||
      !hasDirectoryIdentity(source.stats, value.profileDevice, value.profileInode)
    ) {
      return false
    }
    let replacementRoot: string
    try {
      replacementRoot = await mkdtemp(join(temporaryRoot(), PROFILE_GC_PREFIX))
    } catch {
      return false
    }
    try {
      const replacementRootStats = await lstat(replacementRoot)
      if (!isSafeOwnedDirectory(replacementRootStats)) {
        return false
      }
      const replacementValue = {
        ...value,
        quarantineRootPath: replacementRoot,
        quarantinePath: join(replacementRoot, 'profile'),
        quarantineDevice: replacementRootStats.dev,
        quarantineInode: replacementRootStats.ino
      }
      if (
        !(await recordedProfileIsUnchanged(orcadUserDataPath, owner.recordStats)) ||
        !(await recordedProfileGcIsUnchanged(orcadUserDataPath, gcRecord.recordStats)) ||
        !publishSecureJsonRecord(join(orcadUserDataPath, PROFILE_GC_RECORD_FILE), replacementValue)
      ) {
        return false
      }
      const replacement = await readRecordedProfileGc(orcadUserDataPath)
      if (replacement.kind !== 'valid') {
        return false
      }
      return removeRecordedProfileGc(orcadUserDataPath, replacement, owner, operations)
    } catch {
      return false
    } finally {
      // Only an empty staging quarantine can remain here; never recurse over profile data.
      try {
        rmdirSync(replacementRoot)
      } catch {
        // A published replacement intent owns this root and its retry path.
      }
    }
  }
  if (
    quarantineRoot.kind !== 'present' ||
    !isSafeOwnedDirectory(quarantineRoot.stats) ||
    !hasDirectoryIdentity(quarantineRoot.stats, value.quarantineDevice, value.quarantineInode)
  ) {
    return false
  }

  const source = await lstatProfile(value.profilePath)
  let quarantined = await lstatProfile(value.quarantinePath)
  if (source.kind === 'unknown' || quarantined.kind === 'unknown') {
    return false
  }
  if (source.kind === 'present') {
    if (
      quarantined.kind !== 'missing' ||
      !isSafeOwnedDirectory(source.stats) ||
      !hasDirectoryIdentity(source.stats, value.profileDevice, value.profileInode) ||
      !(await recordedProfileIsUnchanged(orcadUserDataPath, owner.recordStats)) ||
      !(await recordedProfileGcIsUnchanged(orcadUserDataPath, gcRecord.recordStats))
    ) {
      return false
    }
    const sourceAgain = await lstatProfile(value.profilePath)
    const rootAgain = await lstatProfile(value.quarantineRootPath)
    if (
      sourceAgain.kind !== 'present' ||
      !sameDirectoryIdentity(source.stats, sourceAgain.stats) ||
      rootAgain.kind !== 'present' ||
      !sameDirectoryIdentity(quarantineRoot.stats, rootAgain.stats)
    ) {
      return false
    }
    try {
      operations.renameProfile(value.profilePath, value.quarantinePath)
    } catch {
      return false
    }
    quarantined = await lstatProfile(value.quarantinePath)
    if (
      quarantined.kind !== 'present' ||
      !isSafeOwnedDirectory(quarantined.stats) ||
      !hasDirectoryIdentity(quarantined.stats, value.profileDevice, value.profileInode)
    ) {
      // If a replacement won the race, put it back when the recorded name is vacant.
      if (
        quarantined.kind === 'present' &&
        (await lstatProfile(value.profilePath)).kind === 'missing'
      ) {
        try {
          operations.renameProfile(value.quarantinePath, value.profilePath)
        } catch {
          // The durable GC intent retains the path for manual recovery.
        }
      }
      return false
    }
  } else if (
    quarantined.kind === 'present' &&
    (!isSafeOwnedDirectory(quarantined.stats) ||
      !hasDirectoryIdentity(quarantined.stats, value.profileDevice, value.profileInode))
  ) {
    return false
  }

  if (quarantined.kind === 'present') {
    if (
      !(await recordedProfileIsUnchanged(orcadUserDataPath, owner.recordStats)) ||
      !(await recordedProfileGcIsUnchanged(orcadUserDataPath, gcRecord.recordStats))
    ) {
      return false
    }
    const rootAgain = await lstatProfile(value.quarantineRootPath)
    const pathAgain = await lstatProfile(value.quarantinePath)
    if (
      rootAgain.kind !== 'present' ||
      !sameDirectoryIdentity(quarantineRoot.stats, rootAgain.stats) ||
      pathAgain.kind !== 'present' ||
      !sameDirectoryIdentity(quarantined.stats, pathAgain.stats)
    ) {
      return false
    }
    try {
      await operations.removeTree(value.quarantinePath)
    } catch (error) {
      console.warn('[orcad] Electron browser profile quarantine was preserved:', error)
      return false
    }
    if ((await lstatProfile(value.quarantinePath)).kind !== 'missing') {
      return false
    }
  }

  if (!(await recordedProfileIsUnchanged(orcadUserDataPath, owner.recordStats))) {
    return false
  }
  const rootAtEnd = await lstatProfile(value.quarantineRootPath)
  if (rootAtEnd.kind === 'present') {
    if (!sameDirectoryIdentity(quarantineRoot.stats, rootAtEnd.stats)) {
      return false
    }
    try {
      rmdirSync(value.quarantineRootPath)
    } catch {
      return false
    }
  } else if (rootAtEnd.kind !== 'missing') {
    return false
  }
  if (!(await recordedProfileGcIsUnchanged(orcadUserDataPath, gcRecord.recordStats))) {
    return false
  }
  try {
    unlinkSync(join(orcadUserDataPath, PROFILE_GC_RECORD_FILE))
    return true
  } catch {
    return false
  }
}

async function beginRecordedProfileGc(
  orcadUserDataPath: string,
  owner: Extract<RecordedProfile, { kind: 'valid' }>,
  profileStats: Stats,
  operations: ProfileCleanupOperations
): Promise<boolean> {
  let quarantineRootPath: string
  try {
    quarantineRootPath = await mkdtemp(join(temporaryRoot(), PROFILE_GC_PREFIX))
  } catch {
    return false
  }
  try {
    const quarantineRootStats = await lstat(quarantineRootPath)
    if (!isSafeOwnedDirectory(quarantineRootStats)) {
      return false
    }
    const value = {
      profilePath: owner.profilePath,
      ownerRecordDevice: owner.recordStats.dev,
      ownerRecordInode: owner.recordStats.ino,
      ownerRecordSize: owner.recordStats.size,
      ownerRecordMtimeMs: owner.recordStats.mtimeMs,
      profileDevice: profileStats.dev,
      profileInode: profileStats.ino,
      quarantineRootPath,
      quarantinePath: join(quarantineRootPath, 'profile'),
      quarantineDevice: quarantineRootStats.dev,
      quarantineInode: quarantineRootStats.ino
    }
    if (!publishSecureJsonRecord(join(orcadUserDataPath, PROFILE_GC_RECORD_FILE), value)) {
      return false
    }
    const gcRecord = await readRecordedProfileGc(orcadUserDataPath)
    return gcRecord.kind === 'valid'
      ? removeRecordedProfileGc(orcadUserDataPath, gcRecord, owner, operations)
      : false
  } catch (error) {
    console.warn('[orcad] Electron browser profile cleanup intent was not recorded:', error)
    return false
  } finally {
    // The quarantine must remain once the intent is durable; otherwise it is an empty temp root.
    const gcRecord = await readRecordedProfileGc(orcadUserDataPath)
    if (gcRecord.kind !== 'valid' || gcRecord.value.quarantineRootPath !== quarantineRootPath) {
      try {
        rmdirSync(quarantineRootPath)
      } catch {
        // Preserve any unexpected contents for manual inspection.
      }
    }
  }
}

async function removeRecordedProfile(
  orcadUserDataPath: string,
  authority: ProfileCleanupAuthority,
  readUse: typeof readSidecarProfileUse = readSidecarProfileUse,
  expectedProfilePath?: string,
  operations: ProfileCleanupOperations = profileCleanupOperations
): Promise<boolean> {
  const gc = await readRecordedProfileGc(orcadUserDataPath)
  if (gc.kind === 'invalid') {
    return false
  }
  if (gc.kind === 'valid') {
    const owner = await readRecordedProfile(orcadUserDataPath)
    if (
      owner.kind !== 'valid' ||
      !(await removeRecordedProfileGc(orcadUserDataPath, gc, owner, operations))
    ) {
      return false
    }
  }

  const record = await readRecordedProfile(orcadUserDataPath)
  if (record.kind === 'missing') {
    return true
  }
  if (record.kind !== 'valid') {
    return false
  }
  const { profilePath, sidecarExecutableName, recordStats } = record
  if (expectedProfilePath && profilePath !== expectedProfilePath) {
    return false
  }
  const beforeScan = await lstatProfile(profilePath)
  if (beforeScan.kind === 'missing') {
    return recordedProfileIsUnchanged(orcadUserDataPath, recordStats)
  }
  if (authority === 'orphan-recovery') {
    return false
  }
  if (beforeScan.kind !== 'present' || !isSafeOwnedDirectory(beforeScan.stats)) {
    return false
  }
  let use: Awaited<ReturnType<typeof readSidecarProfileUse>>
  try {
    use = await readUse(profilePath, sidecarExecutableName)
  } catch {
    use = 'unavailable'
  }
  // Process snapshots only veto cleanup on positive evidence. Cleanup authority comes from the
  // retained child handle (or proof the profile was never spawned), not a negative census.
  if (use === 'in-use') {
    return false
  }
  if (!(await recordedProfileIsUnchanged(orcadUserDataPath, recordStats))) {
    return false
  }
  const afterScan = await lstatProfile(profilePath)
  if (
    afterScan.kind !== 'present' ||
    !isSafeOwnedDirectory(afterScan.stats) ||
    !sameDirectoryIdentity(beforeScan.stats, afterScan.stats)
  ) {
    return false
  }
  return beginRecordedProfileGc(orcadUserDataPath, record, afterScan.stats, operations)
}

export async function removeNeverLaunchedElectronSidecarProfile(
  orcadUserDataPath: string,
  profilePath: string,
  operations: ProfileCleanupOperations = profileCleanupOperations
): Promise<boolean> {
  return removeRecordedProfile(
    orcadUserDataPath,
    'not-spawned',
    readSidecarProfileUse,
    profilePath,
    operations
  )
}

/** An orphan without its original child handle always needs user-mediated recovery. */
export async function removeLeftoverElectronSidecarProfile(
  orcadUserDataPath: string
): Promise<boolean> {
  return removeRecordedProfile(orcadUserDataPath, 'orphan-recovery')
}

export async function confirmElectronSidecarCleanup(
  child: ChildProcess | null,
  orcadUserDataPath: string,
  cleanupUncertain: boolean,
  readUse: typeof readSidecarProfileUse = readSidecarProfileUse,
  operations: ProfileCleanupOperations = profileCleanupOperations
): Promise<boolean> {
  if (child) {
    if ((await stopElectronSidecar(child)) !== 'confirmed') {
      return false
    }
    return removeRecordedProfile(
      orcadUserDataPath,
      'owned-child-exited',
      readUse,
      undefined,
      operations
    )
  }
  return cleanupUncertain ? removeLeftoverElectronSidecarProfile(orcadUserDataPath) : true
}
