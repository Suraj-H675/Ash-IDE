import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { prepareOrcadSecretStore } from './orcad-host-adapters'
import { assertAshOwnedChildPath, physicalAshDataPath } from './orcad-app-paths'
import { isTemporaryKeyDir } from './orcad-secret-key-record'
import { orcadSecretStatePath } from './orcad-secret-key-resolution'

const ASH_HEADLESS_KEY_DIRECTORY = 'ash-headless-secret-keys'

function assertAshKeyRecordIsIndependent(keyDir: string): void {
  const record = orcadSecretStatePath({ keyDir })
  try {
    const info = lstatSync(record)
    // A link could redirect chmod/hardening or reads into another app's key.
    if (!info.isFile() || info.nlink !== 1) {
      throw new Error('ash_secret_key_record_not_private — links and non-files are refused')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export function ashHeadlessSecretKeyDirectory(userDataPath: string): string {
  const keyDir = join(userDataPath, ASH_HEADLESS_KEY_DIRECTORY)
  assertAshOwnedChildPath(userDataPath, keyDir)
  return keyDir
}

/** Do not rotate a historical Ash profile's encryption key behind the user's back.
 * Pre-isolation server builds stored their key in Orca's home, and that key may
 * have sealed existing Ash profile settings. Neither read nor import it here.
 */
export function mayCreateAshHeadlessSecretKey(
  userDataPath: string,
  options: { temporaryProfile?: boolean; keyRecordPresent?: boolean } = {}
): boolean {
  const keyDir = ashHeadlessSecretKeyDirectory(userDataPath)
  assertAshKeyRecordIsIndependent(keyDir)
  if (options.temporaryProfile ?? isTemporaryKeyDir(physicalAshDataPath(userDataPath))) {
    return true
  }
  if (options.keyRecordPresent ?? existsSync(orcadSecretStatePath({ keyDir }))) {
    return true
  }
  const hasPreviousProfile = ['orca-profile-index.json', 'orca-data.json', 'profiles'].some(
    (name) => existsSync(join(userDataPath, name))
  )
  return !hasPreviousProfile
}

export async function prepareAshHeadlessSecretStore(userDataPath: string): Promise<void> {
  const keyDir = ashHeadlessSecretKeyDirectory(userDataPath)
  assertAshKeyRecordIsIndependent(keyDir)
  const allowNewKey = mayCreateAshHeadlessSecretKey(userDataPath)
  const { reportSecretProtectionGap } = await import('../host/secret-protection-report')
  // Key and ciphertext stay under Ash's independent profile. Temporary QA
  // profiles intentionally avoid key creation. Never enumerate, read or rewrite
  // ~/.orca credentials as a side effect of starting the Ash runtime.
  // Resolve a symlinked profile before testing whether the key would be
  // permanent: a /tmp symlink must not force plaintext on durable storage.
  await prepareOrcadSecretStore(keyDir, physicalAshDataPath(userDataPath), {
    allowNewKey,
    allowLegacyKeyringMigration: false
  })
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'orca-data.json') })
}
