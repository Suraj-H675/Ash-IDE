// Opt-in PK-06 check: read only a bounded Ash profile index through an already
// pinned Linux profile root. Never return profile names, IDs, or file contents.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { TextDecoder } from 'node:util'

const INDEX_FILE_NAME = 'orca-profile-index.json'
const MAX_INDEX_BYTES = 512 * 1024
const MAX_PROFILES = 512
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function sameFile(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(
    (key) => left[key] === right[key]
  )
}

function boundedPinnedIndexBytes(pinnedRoot) {
  const pinnedPath = `${pinnedRoot.path}/${INDEX_FILE_NAME}`
  const fd = openSync(pinnedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o077n) !== 0n ||
      before.size > BigInt(MAX_INDEX_BYTES) ||
      !sameFile(before, lstatSync(pinnedPath, { bigint: true }))
    ) {
      throw new Error('PK-06 profile index has unsafe ownership, type or size')
    }
    const chunks = []
    let total = 0
    const buffer = Buffer.alloc(4096)
    const expectedBytes = Number(before.size)
    while (total < expectedBytes) {
      // Consume only the exact size captured on the opened descriptor. A
      // growing/shrinking index fails the final inode/size/time check.
      const length = Math.min(buffer.length, expectedBytes - total)
      const read = readSync(fd, buffer, 0, length, null)
      if (read === 0) {
        throw new Error('PK-06 profile index became shorter during read')
      }
      total += read
      chunks.push(Buffer.from(buffer.subarray(0, read)))
    }
    if (
      !sameFile(before, fstatSync(fd, { bigint: true })) ||
      !sameFile(before, lstatSync(pinnedPath, { bigint: true })) ||
      total !== expectedBytes
    ) {
      throw new Error('PK-06 profile index changed during read')
    }
    return Buffer.concat(chunks, total)
  } finally {
    closeSync(fd)
  }
}

export function parseStrictProfileIndexIds(jsonText) {
  const index = JSON.parse(jsonText)
  if (
    !index ||
    typeof index !== 'object' ||
    Array.isArray(index) ||
    index.schemaVersion !== 1 ||
    !Array.isArray(index.profiles) ||
    index.profiles.length < 1 ||
    index.profiles.length > MAX_PROFILES
  ) {
    throw new Error('PK-06 profile index is incomplete or has an unknown schema')
  }
  const ids = new Set()
  for (const profile of index.profiles) {
    const id = profile?.id
    if (typeof id !== 'string' || !PROFILE_ID.test(id) || ids.has(id)) {
      throw new Error('PK-06 profile index has an invalid or duplicate identity')
    }
    ids.add(id)
  }
  if (typeof index.activeProfileId !== 'string' || !ids.has(index.activeProfileId)) {
    throw new Error('PK-06 profile index does not identify an indexed active profile')
  }
  return ids
}

export function inspectPinnedProfileIndexIds(pinnedRoot) {
  let bytes
  try {
    bytes = boundedPinnedIndexBytes(pinnedRoot)
  } catch {
    // Never echo path, profile names, file contents or native error details.
    return { state: 'unavailable', ids: null, completedReadBytes: null }
  }
  // Count the original file bytes, never the size of decoded/re-encoded text.
  const completedReadBytes = bytes.length
  try {
    return {
      state: 'validated-id-list',
      ids: parseStrictProfileIndexIds(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      completedReadBytes
    }
  } catch {
    // A complete bounded read may still contain invalid or incompatible JSON.
    return { state: 'unavailable', ids: null, completedReadBytes }
  }
}
