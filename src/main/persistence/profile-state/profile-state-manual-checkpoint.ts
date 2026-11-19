import { ProfileStateRecoveryCommandError } from '../../../shared/profile-state-recovery-command'
import { profileHasPendingProjectMove } from '../../orca-profiles/profile-project-move-record'
import { assertProfileStateMaintenance, type ProfileStateMaintenance } from './profile-state-access'
import { writeProfileStateBackup } from './profile-state-backup-job'
import {
  createProfileStateDatabaseBackupId,
  profileStateDatabaseBackupPath,
  type ProfileStateDatabaseBackup
} from './profile-state-backup-path'
import { getProfileStateExports } from './profile-state-recovery-command'
import { stagePrivateProfileStateDatabase } from './profile-state-private-database'

export async function checkpointProfileState(
  userDataPath: string,
  maintenance: ProfileStateMaintenance,
  profileId?: string
): Promise<ProfileStateDatabaseBackup> {
  const profile = getProfileStateExports(userDataPath, profileId)
  assertProfileStateMaintenance(maintenance, {
    profileId: profile.profileId,
    dataFile: profile.dataFile,
    databasePath: profile.databaseFile
  })
  if (profileHasPendingProjectMove(profile.profileId, userDataPath)) {
    throw new ProfileStateRecoveryCommandError(
      'runtime_error',
      'Resolve the pending project move before taking a single-profile checkpoint.'
    )
  }

  const staged = stagePrivateProfileStateDatabase(profile.databaseFile)
  if (!staged) {
    throw new ProfileStateRecoveryCommandError('runtime_error', 'No SQLite profile to checkpoint.')
  }

  try {
    const createdAtMs = Date.now()
    const id = createProfileStateDatabaseBackupId(createdAtMs)
    const path = profileStateDatabaseBackupPath(profile.databaseFile, id)
    await writeProfileStateBackup({
      requireCommittedState: true,
      databasePath: staged.path,
      profileId: profile.profileId,
      targetPath: path
    })
    return { id, path, createdAtMs }
  } finally {
    staged.remove()
  }
}
