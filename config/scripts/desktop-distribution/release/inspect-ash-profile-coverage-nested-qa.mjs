// Immediate profile-directory metadata, never profile contents or user-defined IDs.
import {
  namesFromPinnedDirectory,
  statPinnedChild,
  withPinnedOwnedDirectory
} from './inspect-ash-profile-coverage-pinned-qa.mjs'
import { inspectPinnedProfileSqlite } from './inspect-ash-profile-sqlite-qa.mjs'

const MAX_PROFILES = 512
const MAX_PROFILE_ENTRIES = 4096
const MAX_TOTAL_PROFILE_ENTRIES = 20_000
const MAX_SQLITE_PROBES = 64

const PROFILE_FILES = new Map([
  ['profile-state.db', 'sqlite-and-recovery'],
  ['profile-state.db-wal', 'sqlite-and-recovery'],
  ['profile-state.db-shm', 'sqlite-and-recovery'],
  ['profile-state.db-journal', 'sqlite-and-recovery'],
  ['profile-state.db.authority', 'sqlite-and-recovery'],
  ['orca-data.json', 'sqlite-and-recovery'],
  ['active-view.json', 'profile-layout-and-browser'],
  ['browser-session-meta.json', 'profile-layout-and-browser'],
  ['browser-host-client-identity.json', 'profile-identity-and-secrets'],
  ['orca-secret-protection.json', 'profile-identity-and-secrets']
])

const BACKUP_FILE =
  /^profile-state\.db\.backup\.[1-9]\d*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db(?:-wal|-shm|-journal)?$/
const CORRUPT_DIRECTORY =
  /^profile-state-corrupt-[1-9]\d*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function knownProfileEntry(name, kind) {
  if (kind === 'file') {
    if (PROFILE_FILES.has(name)) {
      return PROFILE_FILES.get(name)
    }
    if (BACKUP_FILE.test(name) || /^orca-data\.json\.bak\.[0-4]$/.test(name)) {
      return 'sqlite-and-recovery'
    }
  }
  if (kind === 'directory' && CORRUPT_DIRECTORY.test(name)) {
    return 'sqlite-and-recovery'
  }
  if (kind === 'directory' && name === 'browser-extensions') {
    return 'profile-layout-and-browser'
  }
  return null
}

export function inspectImmediateProfiles(
  pinnedRoot,
  expectedProfileIds = null,
  verifyProfileSqlite = false
) {
  return withPinnedOwnedDirectory(`${pinnedRoot.path}/profiles`, (profiles) => {
    const result = {
      profileDirectoryCount: 0,
      inspectedProfileEntryCount: 0,
      unclassifiedProfileEntryCount: 0,
      unsafeProfileEntryCount: 0,
      observedProfileDomainEntryCounts: {
        'sqlite-and-recovery': 0,
        'profile-layout-and-browser': 0,
        'profile-identity-and-secrets': 0
      }
    }
    const ids = namesFromPinnedDirectory(profiles, MAX_PROFILES, 'profile-count')
    const sqliteCounts = verifyProfileSqlite
      ? {
          'schema-3-identity-observed': 0,
          'unsupported-schema': 0,
          'integrity-unproven': 0,
          'identity-mismatch': 0,
          'unfrozen-journal-state': 0,
          missing: 0,
          unavailable: 0
        }
      : null
    const canProbeSqlite =
      sqliteCounts && expectedProfileIds && expectedProfileIds.size <= MAX_SQLITE_PROBES
    let unindexedProfileDirectoryCount = 0
    const matchedProfileIds = new Set()
    for (const id of ids) {
      const info = statPinnedChild(profiles, id)
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ||
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== BigInt(process.getuid()) ||
        (info.mode & 0o077n) !== 0n
      ) {
        result.unsafeProfileEntryCount++
        continue
      }
      result.profileDirectoryCount++
      if (expectedProfileIds) {
        if (expectedProfileIds.has(id)) {
          matchedProfileIds.add(id)
        } else {
          unindexedProfileDirectoryCount++
        }
      }
      withPinnedOwnedDirectory(`${profiles.path}/${id}`, (profile) => {
        const maximum = Math.min(
          MAX_PROFILE_ENTRIES,
          MAX_TOTAL_PROFILE_ENTRIES - result.inspectedProfileEntryCount
        )
        const names = namesFromPinnedDirectory(profile, maximum, 'nested profile')
        for (const name of names) {
          const entry = statPinnedChild(profile, name)
          const kind = entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'unsafe'
          const unsafe =
            kind === 'unsafe' ||
            entry.uid !== BigInt(process.getuid()) ||
            (kind === 'file' && entry.nlink !== 1n)
          result.inspectedProfileEntryCount++
          if (unsafe) {
            result.unsafeProfileEntryCount++
          }
          const domain = unsafe ? null : knownProfileEntry(name, kind)
          if (domain) {
            result.observedProfileDomainEntryCounts[domain]++
          } else {
            result.unclassifiedProfileEntryCount++
          }
        }
        if (
          JSON.stringify(names) !==
          JSON.stringify(namesFromPinnedDirectory(profile, maximum, 'nested profile'))
        ) {
          throw new Error('PK-06 nested profile changed during inspection')
        }
        if (canProbeSqlite && expectedProfileIds.has(id)) {
          const status = inspectPinnedProfileSqlite(profile, id)
          sqliteCounts[status]++
        }
      })
    }
    if (
      JSON.stringify(ids) !==
      JSON.stringify(namesFromPinnedDirectory(profiles, MAX_PROFILES, 'profile-count'))
    ) {
      throw new Error('PK-06 profiles directory changed during inspection')
    }
    if (expectedProfileIds) {
      const missingProfileDirectoryCount = expectedProfileIds.size - matchedProfileIds.size
      result.indexDirectoryConsistency = {
        state:
          missingProfileDirectoryCount === 0 &&
          unindexedProfileDirectoryCount === 0 &&
          result.unsafeProfileEntryCount === 0
            ? 'matching-ids-only'
            : 'mismatch',
        indexedProfileCount: expectedProfileIds.size,
        missingProfileDirectoryCount,
        unindexedProfileDirectoryCount
      }
    }
    if (verifyProfileSqlite) {
      const completeObserved =
        canProbeSqlite &&
        result.indexDirectoryConsistency?.state === 'matching-ids-only' &&
        sqliteCounts['schema-3-identity-observed'] === expectedProfileIds.size
      result.profileSqliteEvidence = {
        state: completeObserved ? 'schema-3-shape-and-identities-observed' : 'incomplete',
        ...(canProbeSqlite ? { statuses: sqliteCounts } : {}),
        maxProbes: MAX_SQLITE_PROBES,
        readOnlyImmutable: true,
        liveWriterFenceEstablished: false,
        crossVersionCompatibilityVerified: false
      }
    }
    return result
  })
}
