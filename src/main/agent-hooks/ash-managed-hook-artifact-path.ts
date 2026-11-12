import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  assertAshOwnedChildPath,
  assertAshUserDataPathIsIndependent
} from '../orcad/orcad-app-paths'

const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

function checkDirectory(path: string): void {
  try {
    const state = lstatSync(path)
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error('ash_managed_hook_directory_not_private')
    }
    if (
      process.platform !== 'win32' &&
      ((state.mode & 0o022) !== 0 || (process.getuid && state.uid !== process.getuid()))
    ) {
      throw new Error('ash_managed_hook_directory_not_private')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

/** Machine-wide Ash hook artifacts; the installed Orca app owns ~/.orca. */
export function getAshManagedHookArtifactRoot(): string {
  const home = homedir()
  const appRoot = join(home, '.ash-ide')
  assertAshUserDataPathIsIndependent(appRoot, { homeDir: home })
  const hooksRoot = join(appRoot, 'agent-hooks')
  assertAshOwnedChildPath(appRoot, hooksRoot)
  checkDirectory(appRoot)
  checkDirectory(hooksRoot)
  return hooksRoot
}

/** Resolve an exact, non-linked artifact; never interpret a nested filename. */
export function getAshManagedHookArtifactPath(
  name: string,
  kind: 'file' | 'directory' = 'file'
): string {
  if (!SAFE_ARTIFACT_NAME.test(name) || name.includes('..')) {
    throw new Error('ash_managed_hook_filename_invalid')
  }
  const root = getAshManagedHookArtifactRoot()
  const target = join(root, name)
  assertAshOwnedChildPath(root, target)
  if (kind === 'directory') {
    checkDirectory(target)
  } else {
    try {
      const file = lstatSync(target)
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) {
        throw new Error('ash_managed_hook_file_not_private')
      }
      if (
        process.platform !== 'win32' &&
        ((file.mode & 0o022) !== 0 || (process.getuid && file.uid !== process.getuid()))
      ) {
        throw new Error('ash_managed_hook_file_not_private')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
  return target
}
