import { ipcRenderer } from 'electron'
import type {
  SkillDeletePlan,
  SkillDeleteRequest,
  SkillDeleteResult
} from '../../shared/skill-delete-contract'
import type { SkillDiscoveryResult, SkillDiscoveryTarget } from '../../shared/skills'
import type {
  BundledSkillAutoUpdateRequest,
  LocalBundledSkillExecuteRequest,
  BundledSkillInstallResult,
  BundledSkillPlan,
  LocalBundledSkillPlanRequest
} from '../../shared/bundled-skill-plan'
import type { PreloadApi } from '../api-types'

/**
 * Keep obsolete preload signatures non-operational until their unmounted Cloud
 * dialogs and shared contracts can be deleted in a separate audited slice.
 * Never forward a stale renderer request to missing IPC handlers or a vendor service.
 */
function unavailableVendorSkillOperation(): Promise<never> {
  return Promise.reject(
    new Error('Orca Cloud skill sharing and managed installs are unavailable in Ash IDE.')
  )
}

export const skillsApi = {
  discover: (target?: SkillDiscoveryTarget): Promise<SkillDiscoveryResult> =>
    ipcRenderer.invoke('skills:discover', target),
  bundledPlan: (request?: LocalBundledSkillPlanRequest): Promise<BundledSkillPlan> =>
    ipcRenderer.invoke('skills:bundledPlan', request ?? {}),
  bundledExecute: (request: LocalBundledSkillExecuteRequest): Promise<BundledSkillInstallResult> =>
    ipcRenderer.invoke('skills:bundledExecute', request),
  bundledAutoUpdate: (request: BundledSkillAutoUpdateRequest): Promise<BundledSkillInstallResult> =>
    ipcRenderer.invoke('skills:bundledAutoUpdate', request),
  prepareShare: unavailableVendorSkillOperation,
  publishShare: unavailableVendorSkillOperation,
  cancelShare: unavailableVendorSkillOperation,
  releaseShare: unavailableVendorSkillOperation,
  resolveShare: unavailableVendorSkillOperation,
  installShare: unavailableVendorSkillOperation,
  installBundleShare: unavailableVendorSkillOperation,
  installBundlePackageVersion: unavailableVendorSkillOperation,
  installPackageVersion: unavailableVendorSkillOperation,
  cancelInstall: unavailableVendorSkillOperation,
  previewInstall: unavailableVendorSkillOperation,
  previewBundleInstall: unavailableVendorSkillOperation,
  removeInstall: unavailableVendorSkillOperation,
  deleteSupported: (): Promise<boolean> => Promise.resolve(true),
  previewDelete: (request: SkillDeleteRequest): Promise<SkillDeletePlan> =>
    ipcRenderer.invoke('skills:previewDelete', request),
  delete: (request: SkillDeleteRequest): Promise<SkillDeleteResult> =>
    ipcRenderer.invoke('skills:delete', request),
  listManagedInstalls: unavailableVendorSkillOperation,
  getPackage: unavailableVendorSkillOperation,
  listOwnedShares: unavailableVendorSkillOperation,
  revokeShare: unavailableVendorSkillOperation,
  deletePackage: unavailableVendorSkillOperation,
  listWslDistros: unavailableVendorSkillOperation,
  onInstallProgress: () => () => {},
  onShareProgress: () => () => {}
} satisfies PreloadApi['skills']
