import { unlink } from 'node:fs/promises'
import { AshHookOwnershipConflict } from './ash-hook-ownership-plan'
import {
  ashProviderFileSha256,
  heldPathForAshProviderSwap,
  stagedPathForAshProviderSwap,
  readAshProviderExisting,
  syncAshProviderParent,
  restoreAshHeldProviderFile
} from './ash-provider-json-guard'
import { reclaimDeadAshProviderWriterLock, withAshProviderLock } from './ash-provider-file-lock'

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
  // Higher-level callers verify their private receipt and ownership claim
  // before recovery; only that same transaction may reclaim its dead lock.
  await reclaimDeadAshProviderWriterLock(configPath, operationId)
  return withAshProviderLock(configPath, operationId, async () => {
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
    const held = await readAshProviderExisting(heldPath, true)
    const current = await readAshProviderExisting(configPath, true)
    if (held && ashProviderFileSha256(held.raw) !== args.beforeSha256) {
      throw new AshHookOwnershipConflict('held provider configuration has changed')
    }
    if (held?.nlink === 2n) {
      // A crash after link(original, held) but before unlink(original)
      // leaves two names for the same untouched inode. Verify BOTH links
      // before discarding only Ash's recoverable backup, never the original.
      if (
        !current ||
        current.nlink !== 2n ||
        current.ino !== held.ino ||
        current.dev !== held.dev ||
        current.raw !== held.raw
      ) {
        throw new AshHookOwnershipConflict('held backup has an unexpected linked peer')
      }
      await unlink(heldPath)
      await syncAshProviderParent(configPath)
      return 'not-published'
    }
    if (current?.nlink === 2n) {
      throw new AshHookOwnershipConflict('provider settings linked to an unknown inode')
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
