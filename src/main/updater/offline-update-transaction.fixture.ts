import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { join, resolve } from 'node:path'
import Database from '../sqlite/sync-database'
import {
  openWritableProfileStateDatabase,
  PROFILE_STATE_DATABASE_FILE_NAME
} from '../persistence/profile-state/profile-state-database'
import { PROFILE_STATE_DATABASE_SCHEMA_VERSION } from '../persistence/profile-state/profile-state-database-schema'
import {
  storeOfflineUpdateGeneration,
  type OfflineUpdateFence,
  type OfflineUpdateBoundary,
  type OfflineUpdateStatePolicy
} from './offline-update-transaction'

const REQUIRED_EXCLUSIONS = [
  'provider-credentials',
  'projects-and-worktrees',
  'caches',
  'legacy-orca-user-data',
  'runtime-session-state'
] as const

export let tempRoot: string
let tempRoots: string[] = []

export function cleanupFixtureRoots(): void {
  for (const path of tempRoots) {
    makeFixtureTreeWritable(path)
    rmSync(path, { recursive: true, force: true })
  }
  tempRoots = []
  tempRoot = ''
}

export function createRoot(): { installRoot: string; dataRoot: string } {
  tempRoot = mkdtempSync(join(tmpdir(), 'ash-offline-update-transaction-'))
  tempRoots.push(tempRoot)
  const installRoot = join(tempRoot, 'install')
  const dataRoot = join(tempRoot, 'user-data')
  mkdirSync(installRoot, { mode: 0o700 })
  mkdirSync(dataRoot, { mode: 0o700 })
  const profileState = join(dataRoot, 'fixture', 'profile-state')
  const browserState = join(dataRoot, 'fixture', 'browser-extensions')
  mkdirSync(profileState, { recursive: true, mode: 0o700 })
  mkdirSync(browserState, { recursive: true, mode: 0o700 })
  const databasePath = join(profileState, PROFILE_STATE_DATABASE_FILE_NAME)
  const opened = openWritableProfileStateDatabase(databasePath, 'fixture')
  opened.db.close()
  writeFileSync(
    join(browserState, 'state.json'),
    JSON.stringify({ schemaVersion: 1, entries: { fixture: 'original' } }),
    { mode: 0o600 }
  )
  return { installRoot, dataRoot }
}

function makeFixtureTreeWritable(path: string): void {
  const info = lstatSync(path)
  if (info.isDirectory() && !info.isSymbolicLink()) {
    chmodSync(path, 0o700)
    for (const child of readdirSync(path)) {
      makeFixtureTreeWritable(join(path, child))
    }
  } else if (info.isFile()) {
    chmodSync(path, 0o600)
  }
}

export function fixturePolicy(): OfflineUpdateStatePolicy {
  return {
    schema: 1,
    sourceProductVersion: '0.1.0',
    targetProductVersion: '0.1.0',
    requiredDomainIds: ['profile-state', 'browser-extension-state'],
    excludedDomains: [...REQUIRED_EXCLUSIONS],
    requiredDomains: [
      {
        id: 'profile-state',
        directory: 'fixture/profile-state',
        schemaVersion: PROFILE_STATE_DATABASE_SCHEMA_VERSION,
        inspectSchema(directory) {
          const database = new Database(join(directory, PROFILE_STATE_DATABASE_FILE_NAME), {
            readonly: true,
            fileMustExist: true
          })
          try {
            const version = database.pragma('user_version', { simple: true }) as number
            if (database.pragma('integrity_check', { simple: true }) !== 'ok') {
              throw new Error('Fixture profile state database failed integrity_check')
            }
            return version
          } finally {
            database.close()
          }
        }
      },
      {
        id: 'browser-extension-state',
        directory: 'fixture/browser-extensions',
        schemaVersion: 1,
        inspectSchema(directory) {
          const value: unknown = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'))
          if (
            typeof value !== 'object' ||
            value === null ||
            !('schemaVersion' in value) ||
            value.schemaVersion !== 1 ||
            !('entries' in value) ||
            typeof value.entries !== 'object' ||
            value.entries === null
          ) {
            throw new Error('Fixture browser extension state has an incompatible schema')
          }
          return 1
        }
      }
    ]
  }
}

export function artifact(path: string, bytes: string): string {
  writeFileSync(path, bytes, { mode: 0o600 })
  return createHash('sha256').update(bytes).digest('hex')
}

export function storeFixtureGeneration(options: {
  installRoot: string
  dataRoot: string
  fence: OfflineUpdateFence
  artifactPath: string
  artifactSha256: string
  onBoundary?: (boundary: OfflineUpdateBoundary) => void
}) {
  return storeOfflineUpdateGeneration({ ...options, statePolicy: fixturePolicy() })
}

export function interceptDirectoryFsync(
  path: string,
  failOnOccurrence?: number
): {
  count(): number
  restore(): void
} {
  const target = resolve(path)
  const original = fs.fsyncSync
  let count = 0
  fs.fsyncSync = (descriptor) => {
    const info = fs.fstatSync(descriptor)
    if (info.isDirectory() && fs.readlinkSync(`/proc/self/fd/${descriptor}`) === target) {
      count += 1
      if (count === failOnOccurrence) {
        throw new Error('injected directory fsync failure')
      }
    }
    return original(descriptor)
  }
  syncBuiltinESMExports()
  return {
    count: () => count,
    restore() {
      fs.fsyncSync = original
      syncBuiltinESMExports()
    }
  }
}

export function interceptJournalCleanupFailures(): { restore(): void } {
  const originalFsync = fs.fsyncSync
  const originalUnlink = fs.unlinkSync
  fs.fsyncSync = (descriptor) => {
    const info = fs.fstatSync(descriptor)
    const path = fs.readlinkSync(`/proc/self/fd/${descriptor}`)
    if (info.isFile() && path.includes('transaction.json.') && path.endsWith('.tmp')) {
      throw new Error('injected journal fsync failure')
    }
    return originalFsync(descriptor)
  }
  fs.unlinkSync = (path) => {
    if (String(path).includes('transaction.json.') && String(path).endsWith('.tmp')) {
      throw new Error('injected journal cleanup failure')
    }
    return originalUnlink(path)
  }
  syncBuiltinESMExports()
  return {
    restore() {
      fs.fsyncSync = originalFsync
      fs.unlinkSync = originalUnlink
      syncBuiltinESMExports()
    }
  }
}
