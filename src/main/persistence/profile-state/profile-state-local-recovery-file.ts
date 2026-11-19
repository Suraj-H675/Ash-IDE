import { lstatSync } from 'node:fs'

/** Reject link aliases before a recovery operation reads or archives profile content. */
export function isLocalProfileStateFile(path: string): boolean {
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.nlink !== 1) {
      throw new Error('Profile-state recovery requires regular files without links')
    }
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}
