// Linux QA-only: open directory inodes once and enumerate via /proc/self/fd.
// A mutable pathname is never used as the enumeration or child-stat target.
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync } from 'node:fs'

function sameSnapshot(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'].every(
    (field) => left[field] === right[field]
  )
}

/** Directory path may itself be reached through an already pinned parent fd. */
export function withPinnedOwnedDirectory(path, callback) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const before = fstatSync(fd, { bigint: true })
    if (
      !before.isDirectory() ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o077n) !== 0n ||
      !sameSnapshot(before, lstatSync(path, { bigint: true }))
    ) {
      throw new Error('PK-06 directory inode is not private and owned')
    }
    const pinned = { path: `/proc/self/fd/${fd}`, before, fd }
    const result = callback(pinned)
    if (
      !sameSnapshot(before, fstatSync(fd, { bigint: true })) ||
      !sameSnapshot(before, lstatSync(path, { bigint: true }))
    ) {
      throw new Error('PK-06 inspected directory changed during metadata discovery')
    }
    return result
  } finally {
    closeSync(fd)
  }
}

/** Streaming bound enforced *before* allocating each additional filename. */
export function namesFromPinnedDirectory(pinned, maximum, label) {
  const cursor = opendirSync(pinned.path)
  const names = []
  try {
    for (let entry = cursor.readSync(); entry !== null; entry = cursor.readSync()) {
      if (names.length >= maximum) {
        throw new Error(`PK-06 ${label} entry budget exceeded`)
      }
      names.push(entry.name)
    }
  } finally {
    cursor.closeSync()
  }
  return names.sort()
}

/** Final component is lstat-ed, so a symlink cannot redirect a child probe. */
export function statPinnedChild(pinned, name) {
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error('PK-06 invalid directory entry')
  }
  return lstatSync(`${pinned.path}/${name}`, { bigint: true })
}
