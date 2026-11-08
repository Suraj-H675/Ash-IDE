import {
  abandonAshClaudeHookInstall,
  AshHookOwnershipConflict,
  confirmAshClaudeHookInstall,
  type AshHookPlan
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
  readAshProviderWriteReceipt,
  finishAshProviderWriteReceipt,
  type AshProviderWriteReceipt
} from './ash-provider-transaction-receipt'

function matchesPreparedClaim(
  plan: AshHookPlan,
  ledger: Awaited<ReturnType<typeof readAshHookOwnershipLedger>>['ledger']
): boolean {
  const expected = ledger.claims.find((claim) => claim.id === plan.claim.id)
  return Boolean(
    expected &&
    expected.state === 'prepared' &&
    JSON.stringify(expected) === JSON.stringify(plan.claim)
  )
}

/**
 * Experimental provider-file transaction, NOT connected to any Ash launch,
 * account, setup or settings callsite. Production provider hooks remain gated.
 *
 * A durable prepared claim MUST precede its receipt; the receipt MUST precede
 * the guarded provider write. Unexpected edits leave the prepared claim and
 * receipt for later recovery. The caller must only pass an approved account
 * configuration; this API is tested with isolated disposable provider homes.
 */
export async function installStagedAshClaudeHookInFile(args: {
  ashUserData: string
  plan: AshHookPlan
  expectedRaw: string | null
}): Promise<{ id: string; ledgerRevision: string | null }> {
  const snapshot = await readAshHookOwnershipLedger(args.ashUserData)
  if (!matchesPreparedClaim(args.plan, snapshot.ledger)) {
    throw new AshHookOwnershipConflict('hook installation was not first durably staged in Ash')
  }
  const { configPath, id } = args.plan.claim
  const before = await readAshClaudeSettingsSnapshot(configPath)
  if ((before?.raw ?? null) !== args.expectedRaw) {
    throw new AshHookOwnershipConflict('provider settings changed since hook plan creation')
  }
  const nextRaw = `${JSON.stringify(args.plan.config, null, 2)}\n`
  // Validate the exact entry BEFORE any side effects, even before receipt creation.
  confirmAshClaudeHookInstall({
    ledger: snapshot.ledger,
    config: args.plan.config,
    configPath,
    id
  })
  const receipt: AshProviderWriteReceipt = {
    schemaVersion: 1,
    owner: 'ash-ide',
    provider: 'claude',
    action: 'install',
    id,
    operationId: id,
    definitionSha256: args.plan.claim.definitionSha256,
    configPath,
    beforeSha256: ashProviderFileSha256(args.expectedRaw),
    afterSha256: ashProviderFileSha256(nextRaw)!
  }
  await createAshProviderWriteReceipt(args.ashUserData, receipt)
  await swapAshClaudeSettingsIfUnchanged({
    configPath,
    operationId: id,
    expectedRaw: args.expectedRaw,
    nextRaw
  })
  const after = await readAshClaudeSettingsSnapshot(configPath)
  if (ashProviderFileSha256(after?.raw ?? null) !== receipt.afterSha256) {
    throw new AshHookOwnershipConflict('provider settings changed immediately after publication')
  }
  const installed = confirmAshClaudeHookInstall({
    ledger: snapshot.ledger,
    config: after?.config,
    configPath,
    id
  })
  const persisted = await saveAshHookOwnershipLedger(args.ashUserData, installed, snapshot.revision)
  await finishAshProviderWriteReceipt(args.ashUserData, receipt)
  return { id, ledgerRevision: persisted.revision }
}

/**
 * Reconcile an interrupted staged install only while its exact Ash claim and
 * receipt survive. Never rewrite an unfamiliar provider edit or a foreign hook.
 * A verified unpublished operation may abandon the prepared claim; a verified
 * published operation confirms the claim as installed.
 */
export async function recoverStagedAshClaudeHookInstall(args: {
  ashUserData: string
  id: string
}): Promise<'abandoned' | 'installed'> {
  const receipt = await readAshProviderWriteReceipt(args.ashUserData, args.id)
  if (receipt.action !== 'install' || receipt.operationId !== args.id) {
    throw new AshHookOwnershipConflict('recovery receipt is not an Ash installation')
  }
  const snapshot = await readAshHookOwnershipLedger(args.ashUserData)
  const claim = snapshot.ledger.claims.find((value) => value.id === receipt.id)
  if (
    !claim ||
    claim.configPath !== receipt.configPath ||
    claim.provider !== 'claude' ||
    claim.definitionSha256 !== receipt.definitionSha256
  ) {
    throw new AshHookOwnershipConflict('recovery receipt has no matching Ash claim')
  }
  const swap = await recoverAshClaudeSettingsSwap({
    configPath: receipt.configPath,
    operationId: receipt.id,
    beforeSha256: receipt.beforeSha256,
    afterSha256: receipt.afterSha256
  })
  const current = await readAshClaudeSettingsSnapshot(receipt.configPath)
  if (swap === 'published') {
    const nextLedger =
      claim.state === 'prepared'
        ? confirmAshClaudeHookInstall({
            ledger: snapshot.ledger,
            config: current?.config,
            configPath: receipt.configPath,
            id: receipt.id
          })
        : snapshot.ledger
    await saveAshHookOwnershipLedger(args.ashUserData, nextLedger, snapshot.revision)
    await finishAshProviderWriteReceipt(args.ashUserData, receipt)
    return 'installed'
  }
  if (claim.state !== 'prepared') {
    throw new AshHookOwnershipConflict('installed claim cannot be abandoned after a failed swap')
  }
  const nextLedger = abandonAshClaudeHookInstall({
    ledger: snapshot.ledger,
    config: current?.config ?? {},
    configPath: receipt.configPath,
    id: receipt.id
  })
  await saveAshHookOwnershipLedger(args.ashUserData, nextLedger, snapshot.revision)
  await finishAshProviderWriteReceipt(args.ashUserData, receipt)
  return 'abandoned'
}
