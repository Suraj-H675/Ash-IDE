import { hasReachedAppVersion } from './app-version'

// Ash has used SQLite profile state since its first version.
export const SQLITE_PROFILE_RELEASE_FLOOR = '0.1.0-0'

export function profileStateBuildCompatibilityError(
  currentVersion: string,
  targetVersion: string
): string | null {
  if (
    !hasReachedAppVersion(currentVersion, SQLITE_PROFILE_RELEASE_FLOOR) ||
    hasReachedAppVersion(targetVersion, SQLITE_PROFILE_RELEASE_FLOOR)
  ) {
    return null
  }
  return 'This build predates SQLite profile storage. Quit Ash IDE and run the current CLI’s “ash-ide profile state rollback --latest-json --profile-id <id>” for each profile before installing it manually.'
}
