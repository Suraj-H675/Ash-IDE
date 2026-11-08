import { unlink } from 'node:fs/promises'
import { AshHookOwnershipConflict } from './ash-hook-ownership-plan'
import {
  ashProviderFileSha256,
  heldPathForAshProviderSwap,
  stagedPathForAshProviderSwap,
  withAshProviderLock,
  readAshProviderExisting,
  syncAshProviderParent,
  restoreAshHeldProviderFile
} from './ash-provider-json-guard'

/**
 * Recover ONLY when the calling Ash transaction has a verified durable receipt
 * containing both hashes and an exact owner id. A third-party edit, symlink,
 * duplicate guard or ambiguous target is left intact for manual recovery.
 */
export async function recoverAshClaudeSettingsSwap(args: {
  configPath: string
  operationId: string
  beforeSha256: string | null
  afterSha256: string
}): Promise<'restored' | 'not-published' | 'published'> {
  const { configPath, operationId } = args
  return withAshProviderLock(configPath, async () => {
    const heldPath = heldPathForAshProviderSwap(configPath, operationId)
    const stagePath = stagedPathForAshProviderSwap(configPath, operationId)
    const staged = await readAshProviderExisting(stagePath, true)
    if (staged) {
      if (ashProviderFileSha256(staged.raw) !== args.afterSha256) {
        throw new AshHookOwnershipConflict('unrecognized staged provider configuration')
      }
      if (staged.nlink === 2n) {
        const target = await readAshProviderExisting(configPath, true)
        if (
          !target ||
          target.ino !== staged.ino ||
          target.dev !== staged.dev ||
          target.raw !== staged.raw
        ) {
          throw new AshHookOwnershipConflict('staged provider hardlink has an unexpected peer')
        }
      }
      await unlink(stagePath)
      await syncAshProviderParent(configPath)
    }
    const held = await readAshProviderExisting(heldPath)
    const current = await readAshProviderExisting(configPath)
    if (held && ashProviderFileSha256(held.raw) !== args.beforeSha256) {
      throw new AshHookOwnershipConflict('held provider configuration has changed')
    }
    if (held && !current) {
      await restoreAshHeldProviderFile(configPath, heldPath)
      return 'restored'
    }
    if (held && current && ashProviderFileSha256(current.raw) !== args.afterSha256) {
      throw new AshHookOwnershipConflict('provider configuration changed after interrupted swap')
    }
    if (held) {
      await unlink(heldPath)
      await syncAshProviderParent(configPath)
      return 'published'
    }
    const observed = ashProviderFileSha256(current?.raw ?? null)
    if (observed === args.beforeSha256) {
      return 'not-published'
    }
    if (observed === args.afterSha256) {
      return 'published'
    }
    throw new AshHookOwnershipConflict('provider configuration does not match transaction receipt')
  })
}
