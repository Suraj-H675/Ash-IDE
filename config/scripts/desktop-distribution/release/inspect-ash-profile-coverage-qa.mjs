// Read-only PK-06 discovery: identify Ash profile-root storage owners without
// reading file contents or treating a list of known names as rollback coverage.
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  inspectImmediateProfiles,
  sameRootSnapshot
} from './inspect-ash-profile-coverage-nested-qa.mjs'

const MAX_ROOT_ENTRIES = 4096

// Names are grounded in Ash's real profile, browser, daemon and CLI stores.
// Classification identifies *owners to investigate*, not disposable data.
const ROOT_DOMAINS = Object.freeze({
  'profile-state': {
    directories: ['profiles', 'profile-move-intents'],
    files: ['orca-profile-index.json', 'keybindings.json']
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

function requirePrivateProfileRoot(rootPath) {
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath) || resolve(rootPath) !== rootPath) {
    throw new Error('PK-06 inventory requires an absolute canonical profile root')
  }
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') {
    throw new Error('PK-06 profile discovery is currently Linux QA only')
  }
  const info = lstatSync(rootPath, { bigint: true })
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== BigInt(process.getuid()) ||
    (info.mode & 0o077n) !== 0n ||
    realpathSync(rootPath) !== rootPath
  ) {
    throw new Error('PK-06 inventory requires a private owned non-symlink directory')
  }
  return info
}

/** Metadata only; no profile bytes, user-defined filenames or absolute paths leave this call. */
export function inspectAshProfileCoverage(rootPath) {
  const before = requirePrivateProfileRoot(rootPath)
  const names = readdirSync(rootPath).sort()
  if (names.length > MAX_ROOT_ENTRIES) {
    throw new Error('PK-06 profile-root entry budget exceeded')
  }
  const observed = Object.fromEntries(Object.keys(ROOT_DOMAINS).map((name) => [name, 0]))
  const seen = new Set()
  let unclassifiedEntryCount = 0
  let unsafeEntryCount = 0
  let mismatchedKnownEntryCount = 0
  for (const name of names) {
    const info = lstatSync(join(rootPath, name), { bigint: true })
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
  const secondPass = readdirSync(rootPath).sort()
  const profileInventory = seen.has('profiles') ? inspectImmediateProfiles(rootPath) : null
  const after = requirePrivateProfileRoot(rootPath)
  if (!sameRootSnapshot(before, after) || JSON.stringify(names) !== JSON.stringify(secondPass)) {
    throw new Error('PK-06 profile root changed during inspection')
  }
  return {
    checkpoint: 'PK-06',
    schema: 1,
    scope: 'owned-linux-profile-root-and-immediate-profiles-metadata-only',
    outcome: 'coverage-unproven',
    activationAvailable: false,
    requiredAnchorsPresent: seen.has('profiles') && seen.has('orca-profile-index.json'),
    observedDomainEntryCounts: observed,
    totalRootEntries: names.length,
    unclassifiedEntryCount,
    unsafeEntryCount,
    mismatchedKnownEntryCount,
    profileInventory,
    uninspectedNestedState: true,
    liveWriterAdmissionVerified: false,
    crossVersionCompatibilityVerified: false,
    fullStateRollbackVerified: false
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--root') {
      throw new Error('Usage: inspect-ash-profile-coverage-qa.mjs --root ABSOLUTE_PRIVATE_PATH')
    }
    process.stdout.write(`${JSON.stringify(inspectAshProfileCoverage(process.argv[3]))}\n`)
  } catch {
    // Do not echo arbitrary profile paths, filesystem names or native errors.
    process.stderr.write('PK-06 private profile-root metadata discovery failed closed\n')
    process.exitCode = 1
  }
}
