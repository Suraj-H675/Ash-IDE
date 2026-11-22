import type { ChildProcess } from 'node:child_process'
import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { spawnProcess } from '@orca/process-host'
import { BROWSER_SIDECAR_OWNER_ENV } from '../../shared/browser-sidecar-lifetime'
import { electronIsolatedProfileSwitches } from '../../shared/electron-isolated-profile-switches'
import { headlessServeOzonePlatformSwitches } from '../../shared/headless-serve-ozone-platform'
import { electronServeEnvironment } from './electron-serve-browser-environment'
import { isSafeOwnedDirectory } from '../../shared/owned-private-directory'
import { isProcessAlive } from '../../shared/serve-bundle-coordination'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { isDirectChild } from '../window/owned-temp-staging-root'
import { readRuntimeMetadataAsync } from '../runtime/rpc/server/runtime-metadata'

const STOP_TIMEOUT_MS = 5_000
const PROFILE_PREFIX = 'orcad-browser-'
// Lives in orcad's private data root, so only this instance can name a profile for removal.
const PROFILE_RECORD_FILE = 'browser-sidecar-profile.json'
const ProfileRecord = z.object({ profilePath: z.string() })

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

export function electronSidecarIsAvailable(
  child: ChildProcess | null,
  runtimePid: number | null
): boolean {
  if (runtimePid === null) {
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
  return child?.pid &&
    child.pid === runtimePid &&
    child.exitCode === null &&
    child.signalCode === null
    ? child.pid
    : null
}

/** Unpredictable per start, so no other account can claim the name first. */
export async function createElectronSidecarProfile(orcadUserDataPath: string): Promise<string> {
  const profilePath = await mkdtemp(join(temporaryRoot(), PROFILE_PREFIX))
  try {
    await writeFile(join(orcadUserDataPath, PROFILE_RECORD_FILE), JSON.stringify({ profilePath }), {
      mode: 0o600
    })
  } catch (error) {
    await removeTree(profilePath).catch(() => undefined)
    throw error
  }
  return profilePath
}

async function readRecordedProfile(orcadUserDataPath: string): Promise<string | null> {
  try {
    const raw = await readFile(join(orcadUserDataPath, PROFILE_RECORD_FILE), 'utf8')
    const { profilePath } = ProfileRecord.parse(JSON.parse(raw))
    return isDirectChild(temporaryRoot(), profilePath) &&
      basename(profilePath).startsWith(PROFILE_PREFIX)
      ? profilePath
      : null
  } catch {
    return null
  }
}

async function orphanSidecarHasExited(profilePath: string): Promise<boolean> {
  const orphan = await readRuntimeMetadataAsync(profilePath).catch(() => undefined)
  // A restarted parent has no ChildProcess handle for this PID. Metadata cannot make a
  // numeric-PID signal atomic with process exit, so preserve the profile when identity is unknown.
  return orphan ? !isProcessAlive(orphan.pid) : false
}

/** Remove a recorded profile only when its sidecar is absent or confirmed dead. */
export async function removeLeftoverElectronSidecarProfile(
  orcadUserDataPath: string
): Promise<boolean> {
  const profilePath = await readRecordedProfile(orcadUserDataPath)
  if (!profilePath) {
    return true
  }
  const stats = await lstat(profilePath).catch(() => null)
  if (!stats) {
    return true
  }
  if (!isSafeOwnedDirectory(stats)) {
    return false
  }
  if (!(await orphanSidecarHasExited(profilePath))) {
    return false
  }
  await removeTree(profilePath).catch((error: unknown) =>
    console.warn('[orcad] Leftover Electron browser sidecar data was not removed:', error)
  )
  return true
}

export async function confirmElectronSidecarCleanup(
  child: ChildProcess | null,
  runtimePid: number | null,
  orcadUserDataPath: string,
  cleanupUncertain: boolean
): Promise<boolean> {
  if (child) {
    if ((await stopElectronSidecar(child)) !== 'confirmed') {
      return false
    }
    if (runtimePid !== null && child.pid !== runtimePid) {
      return removeLeftoverElectronSidecarProfile(orcadUserDataPath)
    }
    return true
  }
  return cleanupUncertain ? removeLeftoverElectronSidecarProfile(orcadUserDataPath) : true
}
