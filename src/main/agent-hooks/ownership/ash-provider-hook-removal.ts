import { randomUUID } from 'node:crypto'
import {
  AshHookOwnershipConflict,
  planAshClaudeHookRemoval,
  type AshHookOwnershipClaim
} from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'
import {
  ashProviderFileSha256,
  readAshClaudeSettingsSnapshot,
  swapAshClaudeSettingsIfUnchanged
} from './ash-provider-json-guard'
import { recoverAshClaudeSettingsSwap } from './ash-provider-json-recovery'
import {
  createAshProviderWriteReceipt,
  finishAshProviderWriteReceipt,
  readAshProviderWriteReceipt,
  type AshProviderWriteReceipt
} from './ash-provider-transaction-receipt'

function requireInstalledClaim(claims: AshHookOwnershipClaim[], id: string): AshHookOwnershipClaim {
  const claim = claims.find((value) => value.id === id)
  if (!claim || claim.provider !== 'claude' || claim.state !== 'installed') {
    throw new AshHookOwnershipConflict('no verified installed Ash hook claim to remove')
  }
  return claim
}

function assertOwnedMarkerAbsent(config: Record<string, unknown> | undefined, id: string): void {
  // Hash equality alone is insufficient: a private receipt might claim the
  // unchanged provider file is the result of an already-published removal.
  // Never discard the only ownership record while its hook marker still exists.
  if (!config || JSON.stringify(config).includes(`ASH_IDE_HOOK_OWNER=${id}`)) {
    throw new AshHookOwnershipConflict('owned hook marker remains after claimed removal')
  }
}

/**
 * Experimental *disposable-file-only* selective removal transaction.
 * No production application callsite may invoke this until Ash can prove
 * cross-process provider coordination and reversible hook installation.
 *
 * The exact ownership claim and provider entry must validate before a durable
 * private removal receipt. The receipt exists before any provider-file write.
 */
export async function removeOwnedAshClaudeHookFromFile(args: {
  ashUserData: string
  id: string
  /** Test-only handshake for a real SIGKILL while the guarded writer is active. */
  testBoundary?: (
    phase:
      | 'stage-synced'
      | 'backup-linked'
      | 'original-held'
      | 'replacement-linked'
      | 'held-cleaned'
  ) => Promise<void>
}): Promise<{ id: string; ledgerRevision: string | null }> {
  const snapshot = await readAshHookOwnershipLedger(args.ashUserData)
  const claim = requireInstalledClaim(snapshot.ledger.claims, args.id)
  const before = await readAshClaudeSettingsSnapshot(claim.configPath)
  if (!before) {
    throw new AshHookOwnershipConflict('installed Ash hook provider configuration is missing')
  }
  const removal = planAshClaudeHookRemoval({
    ledger: snapshot.ledger,
    config: before.config,
    configPath: claim.configPath,
    id: claim.id
  })
  const nextRaw = `${JSON.stringify(removal.config, null, 2)}\n`
  const receipt: AshProviderWriteReceipt = {
    schemaVersion: 1,
    owner: 'ash-ide',
    provider: 'claude',
    action: 'remove',
    id: claim.id,
    operationId: randomUUID(),
    definitionSha256: claim.definitionSha256,
    configPath: claim.configPath,
    beforeSha256: ashProviderFileSha256(before.raw),
    afterSha256: ashProviderFileSha256(nextRaw)!
  }
  await createAshProviderWriteReceipt(args.ashUserData, receipt)
  await swapAshClaudeSettingsIfUnchanged({
    configPath: receipt.configPath,
    operationId: receipt.operationId,
    expectedRaw: before.raw,
    nextRaw,
    testBoundary: args.testBoundary
  })
  const after = await readAshClaudeSettingsSnapshot(claim.configPath)
  if (ashProviderFileSha256(after?.raw ?? null) !== receipt.afterSha256) {
    throw new AshHookOwnershipConflict('provider configuration changed after Ash-owned removal')
  }
  assertOwnedMarkerAbsent(after?.config, claim.id)
  const persisted = await saveAshHookOwnershipLedger(
    args.ashUserData,
    removal.ledger,
    snapshot.revision
  )
  await finishAshProviderWriteReceipt(args.ashUserData, receipt)
  return { id: claim.id, ledgerRevision: persisted.revision }
}

/**
 * Recover a removal from its surviving Ash-private receipt and installed
 * claim. A verified unpublished removal retains ownership; a verified
 * published one clears ONLY its matching Ash claim. An unknown/foreign edit
 * leaves all provider content and the receipt intact for manual inspection.
 */
export async function recoverOwnedAshClaudeHookRemoval(args: {
  ashUserData: string
  id: string
}): Promise<'removed' | 'preserved'> {
  const receipt = await readAshProviderWriteReceipt(args.ashUserData, args.id)
  if (
    receipt.action !== 'remove' ||
    receipt.operationId === receipt.id ||
    receipt.beforeSha256 === null ||
    receipt.beforeSha256 === receipt.afterSha256
  ) {
    throw new AshHookOwnershipConflict('recovery receipt is not an Ash-owned removal')
  }
  const snapshot = await readAshHookOwnershipLedger(args.ashUserData)
  const claim = snapshot.ledger.claims.find((entry) => entry.id === receipt.id)
  if (
    claim &&
    (claim.provider !== 'claude' ||
      claim.state !== 'installed' ||
      claim.configPath !== receipt.configPath ||
      claim.definitionSha256 !== receipt.definitionSha256)
  ) {
    throw new AshHookOwnershipConflict('removal receipt does not match the Ash ownership claim')
  }
  if (!claim) {
    // An already-committed removal may leave the receipt, but the writer has
    // already completed guarded publication (including stage unlink). Its
    // published file must therefore be readable without a hardlink exception.
    // Never restore a held file when the only ownership claim is missing.
    const beforeRecovery = await readAshClaudeSettingsSnapshot(receipt.configPath)
    if (ashProviderFileSha256(beforeRecovery?.raw ?? null) !== receipt.afterSha256) {
      throw new AshHookOwnershipConflict('unpublished removal has no installed Ash claim')
    }
    assertOwnedMarkerAbsent(beforeRecovery?.config, receipt.id)
  }
  // If the claim is still installed, the guarded writer may have died with
  // its stage and published target hardlinked (nlink=2). The low-level
  // recovery verifies the exact stage/target inode before unlinking the
  // stage. An ordinary snapshot read here would incorrectly reject that
  // legitimate intermediate state.
  const swap = await recoverAshClaudeSettingsSwap({
    configPath: receipt.configPath,
    operationId: receipt.operationId,
    beforeSha256: receipt.beforeSha256,
    afterSha256: receipt.afterSha256
  })
  const current = await readAshClaudeSettingsSnapshot(receipt.configPath)
  if (swap === 'published') {
    if (ashProviderFileSha256(current?.raw ?? null) !== receipt.afterSha256) {
      throw new AshHookOwnershipConflict('published provider removal changed during recovery')
    }
    assertOwnedMarkerAbsent(current?.config, receipt.id)
    if (claim) {
      await saveAshHookOwnershipLedger(
        args.ashUserData,
        {
          ...snapshot.ledger,
          claims: snapshot.ledger.claims.filter((entry) => entry.id !== receipt.id)
        },
        snapshot.revision
      )
    }
    await finishAshProviderWriteReceipt(args.ashUserData, receipt)
    return 'removed'
  }
  if (!claim) {
    throw new AshHookOwnershipConflict('unpublished removal has no installed Ash claim')
  }
  if (ashProviderFileSha256(current?.raw ?? null) !== receipt.beforeSha256) {
    throw new AshHookOwnershipConflict('unpublished provider removal changed during recovery')
  }
  // Reverify the *exact* owned entry; never abandon the receipt if it changed.
  planAshClaudeHookRemoval({
    ledger: snapshot.ledger,
    config: current?.config,
    configPath: receipt.configPath,
    id: claim.id
  })
  await finishAshProviderWriteReceipt(args.ashUserData, receipt)
  return 'preserved'
}
