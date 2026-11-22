import type { ChildProcess } from 'node:child_process'
import { lstat, mkdtemp, open } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { spawnProcess } from '@orca/process-host'
import { BROWSER_SIDECAR_OWNER_ENV } from '../../shared/browser-sidecar-lifetime'
import { electronIsolatedProfileSwitches } from '../../shared/electron-isolated-profile-switches'
import { headlessServeOzonePlatformSwitches } from '../../shared/headless-serve-ozone-platform'
import { electronServeEnvironment } from './electron-serve-browser-environment'
import { isSafeOwnedDirectory } from '../../shared/owned-private-directory'
import { writeSecureJsonFile } from '../../shared/secure-file'
import { readPrivateWindowsFile } from '../../shared/secure-path-windows-acl'
import { isProcessAlive } from '../../shared/serve-bundle-coordination'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { isDirectChild } from '../window/owned-temp-staging-root'
import { readSidecarProfileUse } from './electron-sidecar-profile-process-evidence'

const STOP_TIMEOUT_MS = 5_000
const PROFILE_PREFIX = 'orcad-browser-'
// Lives in orcad's private data root, so only this instance can name a profile for removal.
const PROFILE_RECORD_FILE = 'browser-sidecar-profile.json'
const MAX_PROFILE_RECORD_BYTES = 4_096
const ProfileRecord = z
  .object({ profilePath: z.string(), sidecarExecutableName: z.string().optional() })
  .passthrough()

type RecordedProfile =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | {
      kind: 'valid'
      profilePath: string
      sidecarExecutableName?: string
      recordStats: Stats
    }

// Short /tmp, not macOS's long tmpdir(): the sidecar binds its runtime socket in its profile.
function temporaryRoot(): string {
  return process.platform === 'win32' ? tmpdir() : '/tmp'
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
    serialization: 'json'
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
  if (!child.pid || childHasExited(child)) {
    return 'confirmed'
  }
  signalOwnedChild(child, 'SIGTERM')
  if (await waitForChildExit(child, STOP_TIMEOUT_MS)) {
    return 'confirmed'
  }
  signalOwnedChild(child, 'SIGKILL')
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
  try {
    if (
      !writeSecureJsonFile(join(orcadUserDataPath, PROFILE_RECORD_FILE), {
        profilePath,
        ...(executablePath ? { sidecarExecutableName: basename(executablePath) } : {})
      })
    ) {
      throw new Error(
        'Could not verify private permissions on the Electron browser profile record.'
      )
    }
  } catch (error) {
    await removeTree(profilePath).catch(() => undefined)
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

async function readRecordedProfile(orcadUserDataPath: string): Promise<RecordedProfile> {
  const recordPath = join(orcadUserDataPath, PROFILE_RECORD_FILE)
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
    const parsed = ProfileRecord.parse(JSON.parse(buffer.toString('utf8', 0, bytesRead)))
    const { profilePath, sidecarExecutableName } = parsed
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
      recordStats: afterPathRead,
      ...(sidecarExecutableName ? { sidecarExecutableName } : {})
    }
  } catch (error) {
    return { kind: 'invalid' }
  } finally {
    await file?.close().catch(() => undefined)
  }
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

/** Remove a recorded profile only after a complete host snapshot proves its random marker absent. */
export async function removeLeftoverElectronSidecarProfile(
  orcadUserDataPath: string
): Promise<boolean> {
  const record = await readRecordedProfile(orcadUserDataPath)
  if (record.kind === 'missing') {
    return true
  }
  if (record.kind !== 'valid') {
    return false
  }
  const { profilePath, sidecarExecutableName, recordStats } = record
  const beforeScan = await lstatProfile(profilePath)
  if (beforeScan.kind === 'missing') {
    return recordedProfileIsUnchanged(orcadUserDataPath, recordStats)
  }
  if (beforeScan.kind !== 'present') {
    return false
  }
  const stats = beforeScan.stats
  if (!isSafeOwnedDirectory(stats)) {
    return false
  }
  if (
    !isDirectChild(temporaryRoot(), profilePath) ||
    (await readSidecarProfileUse(profilePath, sidecarExecutableName)) !== 'absent'
  ) {
    return false
  }
  if (!(await recordedProfileIsUnchanged(orcadUserDataPath, recordStats))) {
    return false
  }
  const afterScan = await lstatProfile(profilePath)
  if (afterScan.kind === 'missing') {
    return recordedProfileIsUnchanged(orcadUserDataPath, recordStats)
  }
  if (
    afterScan.kind !== 'present' ||
    !isSafeOwnedDirectory(afterScan.stats) ||
    !sameDirectoryIdentity(stats, afterScan.stats)
  ) {
    return false
  }
  try {
    await removeTree(profilePath)
  } catch (error) {
    console.warn('[orcad] Leftover Electron browser sidecar data was not removed:', error)
    return false
  }
  return true
}

export async function confirmElectronSidecarCleanup(
  child: ChildProcess | null,
  orcadUserDataPath: string,
  cleanupUncertain: boolean
): Promise<boolean> {
  if (child) {
    if ((await stopElectronSidecar(child)) !== 'confirmed') {
      return false
    }
    return removeLeftoverElectronSidecarProfile(orcadUserDataPath)
  }
  return cleanupUncertain ? removeLeftoverElectronSidecarProfile(orcadUserDataPath) : true
}
