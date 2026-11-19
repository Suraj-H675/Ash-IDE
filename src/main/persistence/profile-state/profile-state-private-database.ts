import { mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  openProfileStateDatabaseReadOnly,
  ProfileStateDatabaseOpenError
} from './profile-state-database'
import { isLocalProfileStateFile } from './profile-state-local-recovery-file'
import { copyProfileStateRecoveryFiles } from './profile-state-recovery-copy'
import { profileStateDatabaseFiles } from './profile-state-storage-classification'

/** Use only under maintenance. SQLite can create WAL sidecars even on a read-only open. */
export function stagePrivateProfileStateDatabase(databasePath: string): {
  path: string
  remove(): void
} | null {
  const files = profileStateDatabaseFiles(databasePath).filter(isLocalProfileStateFile)
  if (!files.includes(databasePath)) {
    return null
  }
  const directory = mkdtempSync(join(dirname(databasePath), '.ash-state-read-'))
  const remove = () => rmSync(directory, { recursive: true, force: true })
  try {
    copyProfileStateRecoveryFiles(
      files
        .filter((file) => file !== `${databasePath}-shm`)
        .map((source) => ({ source, target: join(directory, basename(source)) }))
    )
    return { path: join(directory, basename(databasePath)), remove }
  } catch (error) {
    remove()
    throw error
  }
}

export function refuseNewerProfileState(databasePath: string, profileId: string): void {
  const staged = stagePrivateProfileStateDatabase(databasePath)
  if (!staged) {
    return
  }
  try {
    openProfileStateDatabaseReadOnly(staged.path, profileId).db.close()
  } catch (error) {
    if (!(error instanceof ProfileStateDatabaseOpenError && error.code === 'unreadable')) {
      throw error
    }
    // Explicit recovery still accepts an unreadable primary.
  } finally {
    staged.remove()
  }
}
