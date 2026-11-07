import { getAppEnvironment } from '../../../shared/app-environment'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PersistedState } from '../../../shared/persisted-state-types'

// Capture after dev redirection but before app.setName changes path casing and loses case-sensitive data.
let _dataFile: string | null = null
let _userDataDir: string | null = null

export function initDataPath(): void {
  const userDataDir = getAppEnvironment().getPath('userData')
  _userDataDir = userDataDir
  _dataFile = join(userDataDir, 'orca-data.json')
}

export function getDataFile(): string {
  if (!_dataFile) {
    const userDataDir = getAppEnvironment().getPath('userData')
    _userDataDir = userDataDir
    _dataFile = join(userDataDir, 'orca-data.json')
  }
  return _dataFile
}

// Cache polls use a disposable sidecar to avoid full-profile rewrites; snapshots accelerate next-launch badges.
export function getGithubCacheFile(dataFile = getDataFile()): string {
  return join(dirname(dataFile), 'orca-github-cache.json')
}

export function readGithubCacheSnapshot(dataFile: string): PersistedState['githubCache'] | null {
  try {
    const parsed = JSON.parse(readFileSync(getGithubCacheFile(dataFile), 'utf-8')) as unknown
    const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
    if (
      isPlainRecord(parsed) &&
      isPlainRecord((parsed as { pr?: unknown }).pr) &&
      isPlainRecord((parsed as { issue?: unknown }).issue)
    ) {
      return parsed as PersistedState['githubCache']
    }
  } catch {}
  return null
}

/** Reuse the path captured before app.setName; late resolution can change casing and strand paired devices. */
export function getCanonicalUserDataPath(): string {
  if (!_userDataDir) {
    _userDataDir = getAppEnvironment().getPath('userData')
  }
  return _userDataDir
}

