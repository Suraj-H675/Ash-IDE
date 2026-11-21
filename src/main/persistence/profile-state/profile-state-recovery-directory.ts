import { closeSync, constants, fstatSync, lstatSync, openSync } from 'node:fs'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'

export type ProfileStateRecoveryDirectorySnapshot = {
  path: string
  component: string
  info: NonNullable<ReturnType<typeof lstatSync>>
}

export function snapshotProfileStateRecoveryDirectories(
  filePath: string
): ProfileStateRecoveryDirectorySnapshot[] {
  const resolved = resolve(filePath)
  const root = parse(resolved).root
  const parent = dirname(resolved)
  const rootInfo = lstatSync(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Profile-state recovery source has a linked or non-directory ancestor')
  }
  const snapshots: ProfileStateRecoveryDirectorySnapshot[] = [
    {
      path: root,
      component: '',
      info: rootInfo
    }
  ]
  let current = root
  for (const component of relative(root, parent).split(sep).filter(Boolean)) {
    current = join(current, component)
    const info = lstatSync(current)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Profile-state recovery source has a linked or non-directory ancestor')
    }
    snapshots.push({ path: current, component, info })
  }
  return snapshots
}

export function sameProfileStateRecoveryDirectoryIdentity(
  opened: ReturnType<typeof fstatSync>,
  expected: NonNullable<ReturnType<typeof lstatSync>>
): boolean {
  return (
    opened.isDirectory() &&
    !expected.isSymbolicLink() &&
    expected.isDirectory() &&
    opened.dev === expected.dev &&
    opened.ino === expected.ino
  )
}

export function openPinnedLinuxProfileStateRecoveryDirectory(
  snapshots: readonly ProfileStateRecoveryDirectorySnapshot[]
): number {
  if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_DIRECTORY !== 'number') {
    throw new Error('Linux profile-state recovery requires no-follow directory-open support')
  }
  const first = snapshots[0]
  if (!first) {
    throw new Error('Profile-state recovery directory path is incomplete')
  }
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  let current = openSync(first.path, flags)
  try {
    if (!sameProfileStateRecoveryDirectoryIdentity(fstatSync(current), first.info)) {
      throw new Error('Profile-state recovery ancestor changed before directory pinning')
    }
    for (const snapshot of snapshots.slice(1)) {
      let next: number | undefined
      try {
        next = openSync(`/proc/self/fd/${current}/${snapshot.component}`, flags)
        if (!sameProfileStateRecoveryDirectoryIdentity(fstatSync(next), snapshot.info)) {
          throw new Error('Profile-state recovery ancestor changed before directory pinning')
        }
        closeSync(current)
        current = next
        next = undefined
      } finally {
        if (next !== undefined) {
          closeSync(next)
        }
      }
    }
    return current
  } catch (error) {
    try {
      closeSync(current)
    } catch {
      // Preserve the directory-open or identity error.
    }
    throw error
  }
}

export function isSameProfileStateRecoveryDirectory(
  path: string,
  opened: ReturnType<typeof fstatSync>,
  expected: NonNullable<ReturnType<typeof lstatSync>>
): boolean {
  try {
    const named = lstatSync(path)
    return (
      named.isDirectory() &&
      !named.isSymbolicLink() &&
      sameProfileStateRecoveryDirectoryIdentity(opened, expected) &&
      named.dev === opened.dev &&
      named.ino === opened.ino
    )
  } catch {
    return false
  }
}
