import { lstat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize } from 'node:path'
import { AshHookOwnershipConflict } from './ash-hook-ownership-plan'

/**
 * POSIX-only Claude settings target policy. This is a preflight check, not
 * an openat2-style guarantee against another process swapping path ancestors.
 */
export function validateAshProviderTarget(configPath: string): void {
  if (
    process.platform === 'win32' ||
    !isAbsolute(configPath) ||
    normalize(configPath) !== configPath ||
    configPath.includes('\0') ||
    configPath.length > 4096 ||
    basename(configPath) !== 'settings.json'
  ) {
    throw new AshHookOwnershipConflict('unsupported or unsafe POSIX Claude settings target')
  }
}

export async function validateAshProviderParent(configPath: string): Promise<void> {
  validateAshProviderTarget(configPath)
  const parentPath = dirname(configPath)
  const parent = await lstat(parentPath)
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new AshHookOwnershipConflict('provider settings parent is not a real directory')
  }
  if ((parent.mode & 0o002) !== 0 || (process.getuid && parent.uid !== process.getuid())) {
    throw new AshHookOwnershipConflict('provider settings parent is not user-owned and protected')
  }
  let ancestor = dirname(parentPath)
  while (ancestor !== parentPath) {
    const entry = await lstat(ancestor)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new AshHookOwnershipConflict('provider settings path contains a symlinked ancestor')
    }
    const next = dirname(ancestor)
    if (next === ancestor) {
      break
    }
    ancestor = next
  }
}
