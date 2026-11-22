// Manual PK-06 evidence only: bounded read-only SQLite observation from a
// pinned directory and inherited fd. Never open a live writer or copy state.
import { spawnSync } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { statPinnedChild } from './inspect-ash-profile-coverage-pinned-qa.mjs'

const WORKER = fileURLToPath(new URL('./inspect-ash-profile-sqlite-worker-qa.cjs', import.meta.url))
const DATABASE_NAME = 'profile-state.db'
const MAX_DB_BYTES = 64 * 1024 * 1024
const MAX_WORKER_MS = 4_000
const STATES = new Set([
  'schema-3-identity-observed',
  'unsupported-schema',
  'integrity-unproven',
  'identity-mismatch',
  'unavailable'
])

function sameFile(left, right) {
  return ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'].every(
    (name) => left[name] === right[name]
  )
}

function privateRegularFile(info) {
  return (
    info.isFile() &&
    info.uid === BigInt(process.getuid()) &&
    info.nlink === 1n &&
    (info.mode & 0o077n) === 0n
  )
}

function safeStatChild(pinned, name) {
  try {
    return statPinnedChild(pinned, name)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/** A closed WAL database can retain a nonempty SHM index after a full checkpoint.
 * A nonempty rollback journal, however, may require recovery: immutable=1
 * bypasses that recovery and can present stale/uncommitted page data.
 */
function coldSidecarState(pinned) {
  for (const name of [`${DATABASE_NAME}-wal`, `${DATABASE_NAME}-shm`, `${DATABASE_NAME}-journal`]) {
    const file = safeStatChild(pinned, name)
    if (
      file &&
      (!privateRegularFile(file) ||
        ((name.endsWith('-wal') || name.endsWith('-journal')) && file.size !== 0n) ||
        (name.endsWith('-shm') && file.size > 1024n * 1024n))
    ) {
      return 'unfrozen-journal-state'
    }
  }
  return 'no-pending-sidecar-bytes-observed'
}

/** Returns a status only, never the profile identity or DB content. */
export function inspectPinnedProfileSqlite(pinnedProfile, profileId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(profileId)) {
    return 'unavailable'
  }
  const path = `${pinnedProfile.path}/${DATABASE_NAME}`
  let fd
  try {
    const file = safeStatChild(pinnedProfile, DATABASE_NAME)
    if (!file) {
      return 'missing'
    }
    if (!privateRegularFile(file) || file.size === 0n || file.size > BigInt(MAX_DB_BYTES)) {
      return 'unavailable'
    }
    if (coldSidecarState(pinnedProfile) !== 'no-pending-sidecar-bytes-observed') {
      return 'unfrozen-journal-state'
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const opened = fstatSync(fd, { bigint: true })
    if (!sameFile(file, opened)) {
      return 'unavailable'
    }
    // fd 3 is inherited from this already-opened file, not re-resolved by name.
    const subprocess = spawnSync(process.execPath, [WORKER], {
      input: profileId,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore', fd],
      timeout: MAX_WORKER_MS,
      maxBuffer: 1024,
      env: { TZ: 'UTC' }
    })
    const after = fstatSync(fd, { bigint: true })
    if (
      !sameFile(file, after) ||
      !sameFile(file, lstatSync(path, { bigint: true })) ||
      coldSidecarState(pinnedProfile) !== 'no-pending-sidecar-bytes-observed'
    ) {
      return 'unavailable'
    }
    if (subprocess.status !== 0 || subprocess.error) {
      return 'unavailable'
    }
    const result = JSON.parse(subprocess.stdout)
    return STATES.has(result?.state) ? result.state : 'unavailable'
  } catch {
    return 'unavailable'
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}
