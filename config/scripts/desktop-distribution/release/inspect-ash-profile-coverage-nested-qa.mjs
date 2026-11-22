// Immediate profile-directory metadata, never profile contents or user-defined IDs.
import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MAX_PROFILES = 512
const MAX_PROFILE_ENTRIES = 4096
const MAX_TOTAL_PROFILE_ENTRIES = 20_000

export function sameRootSnapshot(before, after) {
  return ['dev', 'ino', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'].every(
    (property) => before[property] === after[property]
  )
}

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

export function inspectImmediateProfiles(rootPath) {
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
  const profiles = join(rootPath, 'profiles')
  const rootInfo = lstatSync(profiles, { bigint: true })
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    rootInfo.uid !== BigInt(process.getuid()) ||
    (rootInfo.mode & 0o077n) !== 0n
  ) {
    throw new Error('PK-06 profiles directory is not private and owned')
  }
  const ids = readdirSync(profiles).sort()
  if (ids.length > MAX_PROFILES) {
    throw new Error('PK-06 profile count budget exceeded')
  }
  for (const id of ids) {
    const directory = join(profiles, id)
    const before = lstatSync(directory, { bigint: true })
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ||
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o077n) !== 0n
    ) {
      result.unsafeProfileEntryCount++
      continue
    }
    result.profileDirectoryCount++
    const names = readdirSync(directory).sort()
    if (
      names.length > MAX_PROFILE_ENTRIES ||
      result.inspectedProfileEntryCount + names.length > MAX_TOTAL_PROFILE_ENTRIES
    ) {
      throw new Error('PK-06 nested profile entry budget exceeded')
    }
    for (const name of names) {
      const info = lstatSync(join(directory, name), { bigint: true })
      const kind = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'unsafe'
      const unsafe =
        kind === 'unsafe' ||
        info.uid !== BigInt(process.getuid()) ||
        (kind === 'file' && info.nlink !== 1n)
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
      !sameRootSnapshot(before, lstatSync(directory, { bigint: true })) ||
      JSON.stringify(names) !== JSON.stringify(readdirSync(directory).sort())
    ) {
      throw new Error('PK-06 nested profile changed during inspection')
    }
  }
  if (
    !sameRootSnapshot(rootInfo, lstatSync(profiles, { bigint: true })) ||
    JSON.stringify(ids) !== JSON.stringify(readdirSync(profiles).sort())
  ) {
    throw new Error('PK-06 profiles directory changed during inspection')
  }
  return result
}
