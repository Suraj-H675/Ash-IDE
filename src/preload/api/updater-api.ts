import type {
  LinuxPackageInstallInstructions,
  ReleaseBuildListResult,
  UpdateCheckOptions,
  UpdateStatus
} from '../../shared/update-status-types'
import type { ReleaseChannel } from '../../shared/release-channel'
import type { UpdatePreflightReport } from '../../shared/update-preflight-types'

export type UpdaterApi = {
  getVersion: () => Promise<string>
  getStatus: () => Promise<UpdateStatus>
  /** Read-only local census. It never makes an update available or interrupts runtime work. */
  getPreflight: () => Promise<UpdatePreflightReport>
  check: (options?: UpdateCheckOptions) => Promise<void>
  download: () => Promise<void>
  quitAndInstall: () => Promise<void>
  dismissNudge: () => Promise<void>
  dismissAvailableUpdate: () => Promise<void>
  /** Desktop-only. Rejects unless the current status carries `linux-package-install` recovery. */
  getLinuxPackageInstallInstructions: () => Promise<LinuxPackageInstallInstructions>
  /** Desktop-only. Reveals the revalidated cached package in the native file manager. */
  showLinuxPackage: () => Promise<void>
  /** Use force to bypass the cache only for an explicit refresh. */
  listBuilds: (
    channel: ReleaseChannel,
    options?: { force?: boolean }
  ) => Promise<ReleaseBuildListResult>

  onStatus: (callback: (status: UpdateStatus) => void) => () => void
  onClearDismissal: (callback: () => void) => () => void
}
