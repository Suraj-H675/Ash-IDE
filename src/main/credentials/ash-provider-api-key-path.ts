import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  assertAshOwnedChildPath,
  assertAshUserDataPathIsIndependent
} from '../orcad/orcad-app-paths'

/** Retained provider credentials belong to the active Ash profile, never ~/.orca. */
function ashProviderCredentialPath(fileName: string, suffix: 'enc' | 'json'): string {
  const valid =
    suffix === 'enc'
      ? /^[a-z0-9][a-z0-9-]*\.enc$/.test(fileName)
      : /^[a-z0-9][a-z0-9-]*\.json$/.test(fileName)
  if (!valid) {
    throw new Error('ash_provider_api_key_filename_invalid')
  }
  const environment = getAppEnvironment()
  const profile = environment.getPath('userData')
  assertAshUserDataPathIsIndependent(profile, { homeDir: environment.getPath('home') })
  const target = join(profile, 'provider-credentials', fileName)
  assertAshOwnedChildPath(profile, target)
  try {
    const existing = lstatSync(target)
    // The secure-file reader/hardener must never follow a foreign hard link or symlink.
    if (!existing.isFile() || existing.nlink !== 1) {
      throw new Error('ash_provider_api_key_record_not_private')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  return target
}

/** Guard the key envelope, including status checks and clear operations. */
export function ashProviderApiKeyPath(fileName: string): string {
  return ashProviderCredentialPath(fileName, 'enc')
}

/** Bitbucket's non-secret metadata must have the same ownership boundary. */
export function ashProviderMetadataPath(fileName: string): string {
  return ashProviderCredentialPath(fileName, 'json')
}
