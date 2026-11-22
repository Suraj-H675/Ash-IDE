// Read-only PK-06 discovery: identify Ash profile-root storage owners without
// reading file contents or treating a list of known names as rollback coverage.
import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectPinnedProfileIndexIds } from './inspect-ash-profile-index-qa.mjs'
import { inspectImmediateProfiles } from './inspect-ash-profile-coverage-nested-qa.mjs'
import {
  namesFromPinnedDirectory,
  statPinnedChild,
  withPinnedOwnedDirectory
} from './inspect-ash-profile-coverage-pinned-qa.mjs'

const MAX_ROOT_ENTRIES = 4096

// Names are grounded in Ash's real profile, browser, daemon and CLI stores.
// Classification identifies *owners to investigate*, not disposable data.
const ROOT_DOMAINS = Object.freeze({
  'profile-state': {
    directories: ['profiles', 'profile-move-intents'],
    files: ['orca-profile-index.json', 'orca-profile-index.json.bak', 'keybindings.json']
  },
  'browser-persistent-state': {
    directories: [
      'Partitions',
      'Local Storage',
      'Session Storage',
      'IndexedDB',
      'WebStorage',
      'blob_storage',
      'browser-extensions'
    ],
    files: [
      'Cookies',
      'Cookies-journal',
      'DIPS',
      'Local State',
      'Network Persistent State',
      'Preferences',
      'TransportSecurity',
      'Trust Tokens',
      'Trust Tokens-journal'
    ]
  },
  'runtime-pty-and-provider-state': {
    directories: [
      '.profile-state-access',
      'daemon',
      'terminal-history',
      'codex-runtime-home',
      'agent-hooks',
      'linux-ash-cli-shim'
    ],
    files: [
      'agent-session-authority.key',
      'host-installation.json',
      'orchestration.db',
      'orchestration.db-wal',
      'orchestration.db-shm',
      'orchestration.db-journal'
    ]
  },
  'cache-and-diagnostic-state': {
    directories: [
      'Cache',
      'Code Cache',
      'Crashpad',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Dictionaries',
      'GPUCache',
      'Shared Dictionary',
      'logs'
    ],
    files: ['http1-compatibility.json', 'orca-stats.json']
  }
})

const INDEX = new Map()
for (const [domain, names] of Object.entries(ROOT_DOMAINS)) {
  for (const [kind, entries] of Object.entries(names)) {
    for (const name of entries) {
      if (INDEX.has(name)) {
        throw new Error('Ambiguous Ash storage-domain registry')
      }
      INDEX.set(name, { domain, kind: kind === 'files' ? 'file' : 'directory' })
    }
  }
}

function requireCanonicalProfileRoot(rootPath) {
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath) || resolve(rootPath) !== rootPath) {
    throw new Error('PK-06 inventory requires an absolute canonical profile root')
  }
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') {
    throw new Error('PK-06 profile discovery is currently Linux QA only')
  }
  if (realpathSync(rootPath) !== rootPath) {
    throw new Error('PK-06 inventory requires an unaliased profile path')
  }
}

/** Metadata only; no profile bytes, user-defined filenames or absolute paths leave this call. */
export function inspectAshProfileCoverage(
  rootPath,
  { verifyProfileIndex = false, verifyProfileSqlite = false } = {}
) {
  if (verifyProfileSqlite && !verifyProfileIndex) {
    throw new Error('PK-06 SQLite profile check requires verified profile-index opt-in')
  }
  requireCanonicalProfileRoot(rootPath)
  return withPinnedOwnedDirectory(rootPath, (root) => {
    const names = namesFromPinnedDirectory(root, MAX_ROOT_ENTRIES, 'profile-root')
    const observed = Object.fromEntries(Object.keys(ROOT_DOMAINS).map((name) => [name, 0]))
    const seen = new Set()
    let unclassifiedEntryCount = 0
    let unsafeEntryCount = 0
    let mismatchedKnownEntryCount = 0
    for (const name of names) {
      const info = statPinnedChild(root, name)
      const kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'unsafe'
      const unsafe =
        kind === 'unsafe' ||
        info.uid !== BigInt(process.getuid()) ||
        (kind === 'file' && info.nlink !== 1n)
      if (unsafe) {
        unsafeEntryCount++
      }
      const recognized = INDEX.get(name)
      if (!recognized) {
        unclassifiedEntryCount++
      } else if (unsafe || recognized.kind !== kind) {
        mismatchedKnownEntryCount++
      } else {
        observed[recognized.domain]++
        seen.add(name)
      }
    }
    const secondPass = namesFromPinnedDirectory(root, MAX_ROOT_ENTRIES, 'profile-root')
    const index = verifyProfileIndex ? inspectPinnedProfileIndexIds(root) : null
    const profileInventory = seen.has('profiles')
      ? inspectImmediateProfiles(root, index?.ids ?? null, verifyProfileSqlite)
      : null
    const { indexDirectoryConsistency, profileSqliteEvidence, ...publicProfileInventory } =
      profileInventory ?? {}
    if (JSON.stringify(names) !== JSON.stringify(secondPass)) {
      throw new Error('PK-06 profile root changed during inspection')
    }
    return {
      checkpoint: 'PK-06',
      schema: 1,
      scope: verifyProfileSqlite
        ? 'owned-linux-profile-root-and-sqlite-schema3-observation'
        : verifyProfileIndex
          ? 'owned-linux-profile-root-and-index-id-reconciliation'
          : 'owned-linux-profile-root-and-immediate-profiles-metadata-only',
      outcome: 'coverage-unproven',
      activationAvailable: false,
      requiredAnchorsPresent: seen.has('profiles') && seen.has('orca-profile-index.json'),
      observedDomainEntryCounts: observed,
      totalRootEntries: names.length,
      unclassifiedEntryCount,
      unsafeEntryCount,
      mismatchedKnownEntryCount,
      profileInventory: profileInventory ? publicProfileInventory : null,
      ...(verifyProfileIndex
        ? {
            profileIndexDirectoryCheck: indexDirectoryConsistency ?? { state: 'unavailable' },
            profileIndexValidationState: index?.state ?? 'unavailable',
            profileIndexReadAttempted: true,
            // Null means no *verified complete* read. It does not imply no
            // bytes were touched before an incomplete read failed.
            profileIndexCompletedReadBytes: index?.completedReadBytes ?? null
          }
        : {}),
      ...(verifyProfileSqlite
        ? {
            profileSqliteEvidence: profileSqliteEvidence ?? {
              state: 'incomplete'
            }
          }
        : {}),
      uninspectedNestedState: true,
      liveWriterAdmissionVerified: false,
      crossVersionCompatibilityVerified: false,
      fullStateRollbackVerified: false
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (
      (process.argv.length !== 4 && process.argv.length !== 5 && process.argv.length !== 6) ||
      process.argv[2] !== '--root' ||
      (process.argv.length >= 5 && process.argv[4] !== '--verify-profile-index') ||
      (process.argv.length === 6 && process.argv[5] !== '--verify-profile-sqlite')
    ) {
      throw new Error(
        'Usage: inspect-ash-profile-coverage-qa.mjs --root ABSOLUTE_PRIVATE_PATH [--verify-profile-index [--verify-profile-sqlite]]'
      )
    }
    process.stdout.write(
      `${JSON.stringify(
        inspectAshProfileCoverage(process.argv[3], {
          verifyProfileIndex: process.argv.length >= 5,
          verifyProfileSqlite: process.argv.length === 6
        })
      )}\n`
    )
  } catch {
    // Do not echo arbitrary profile paths, filesystem names or native errors.
    process.stderr.write('PK-06 private profile-root metadata discovery failed closed\n')
    process.exitCode = 1
  }
}
