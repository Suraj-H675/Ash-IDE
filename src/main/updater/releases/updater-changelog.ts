import type { ChangelogData } from '../../../shared/update-status-types'

export async function fetchChangelog(
  _incomingVersion: string,
  _localVersion: string
): Promise<ChangelogData | null> {
  return null
}
