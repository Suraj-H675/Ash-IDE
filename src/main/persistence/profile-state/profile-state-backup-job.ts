import { openProfileStateDatabaseReadOnly } from './profile-state-database'
import { writeProfileStateDatabaseSnapshotAsync } from './profile-state-database-snapshot'
import { validateProfileStateSnapshot } from './profile-state-documents'

export type ProfileStateBackupJob = {
  databasePath: string
  profileId: string
  targetPath: string
  temporaryPath?: string
  requireCommittedState?: boolean
}

/** Retain connections through snapshot copy and strict validation. */
export async function writeProfileStateBackup(job: ProfileStateBackupJob): Promise<void> {
  const opened = openProfileStateDatabaseReadOnly(job.databasePath, job.profileId)
  try {
    await writeProfileStateDatabaseSnapshotAsync(opened.db, job.targetPath, {
      temporaryPath: job.temporaryPath,
      validateStagedSnapshot: (stagingPath) => {
        const snapshot = openProfileStateDatabaseReadOnly(stagingPath, job.profileId)
        try {
          const revision = validateProfileStateSnapshot(snapshot.db)
          if (job.requireCommittedState && revision === 0) {
            throw new Error('Profile state has no committed revision to checkpoint')
          }
        } finally {
          snapshot.db.close()
        }
      }
    })
  } finally {
    opened.db.close()
  }
}
