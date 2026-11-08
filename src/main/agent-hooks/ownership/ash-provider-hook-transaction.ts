import { constants } from 'node:fs'
import { join } from 'node:path'
import { lstat, open, unlink } from 'node:fs/promises'
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

const SHA256 = /^[0-9a-f]{64}$/
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const MAX_RECEIPT_BYTES = 4096

type AshProviderWriteReceipt = {
  schemaVersion: 1
  owner: 'ash-ide'
  provider: 'claude'
  id: string
  configPath: string
  beforeSha256: string | null
  afterSha256: string
}

function receiptPath(userData: string, id: string): string {
  if (!UUID_V4.test(id)) {
    throw new AshHookOwnershipConflict('invalid transaction owner identity')
  }
  return join(userData, 'provider-hook-ownership', `pending-${id}.json`)
}

function validReceipt(raw: unknown): AshProviderWriteReceipt {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw) ||
    !('schemaVersion' in raw) ||
    raw.schemaVersion !== 1 ||
    !('owner' in raw) ||
    raw.owner !== 'ash-ide' ||
    !('provider' in raw) ||
    raw.provider !== 'claude' ||
    !('id' in raw) ||
    typeof raw.id !== 'string' ||
    !UUID_V4.test(raw.id) ||
    !('configPath' in raw) ||
    typeof raw.configPath !== 'string' ||
    !('beforeSha256' in raw) ||
    (raw.beforeSha256 !== null &&
      (typeof raw.beforeSha256 !== 'string' || !SHA256.test(raw.beforeSha256))) ||
    !('afterSha256' in raw) ||
    typeof raw.afterSha256 !== 'string' ||
    !SHA256.test(raw.afterSha256)
  ) {
    throw new AshHookOwnershipConflict('invalid or untrusted provider-write receipt')
  }
  return raw as AshProviderWriteReceipt
}

async function fsyncDirectory(path: string): Promise<void> {
  const fd = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
  try {
    await fd.sync()
  } finally {
    await fd.close()
  }
}

async function readReceipt(userData: string, id: string): Promise<AshProviderWriteReceipt> {
  await readAshHookOwnershipLedger(userData) // fail closed on missing/insecure Ash-owned root
  const path = receiptPath(userData, id)
  const stat = await lstat(path)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > MAX_RECEIPT_BYTES ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  ) {
    throw new AshHookOwnershipConflict('transaction receipt is not a private, bounded file')
  }
  const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await fd.stat()
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev ||
      (process.platform !== 'win32' && (opened.mode & 0o077) !== 0)
    ) {
      throw new AshHookOwnershipConflict('transaction receipt changed while being opened')
    }
    const raw = await fd.readFile('utf8')
    if (Buffer.byteLength(raw) > MAX_RECEIPT_BYTES) {
      throw new AshHookOwnershipConflict('transaction receipt is oversized')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new AshHookOwnershipConflict('transaction receipt is corrupt JSON')
    }
    const receipt = validReceipt(parsed)
    if (receipt.id !== id) {
      throw new AshHookOwnershipConflict('transaction receipt identity mismatch')
    }
    return receipt
  } finally {
    await fd.close()
  }
}

async function createReceipt(userData: string, receipt: AshProviderWriteReceipt): Promise<void> {
  await readAshHookOwnershipLedger(userData)
  const path = receiptPath(userData, receipt.id)
  const fd = await open(path, 'wx', 0o600).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new AshHookOwnershipConflict('existing transaction must be recovered before retry')
    }
    throw error
  })
  try {
    await fd.writeFile(`${JSON.stringify(receipt)}\n`, 'utf8')
    await fd.sync()
  } finally {
    await fd.close()
  }
  await fsyncDirectory(join(userData, 'provider-hook-ownership'))
}

async function finishReceipt(userData: string, expected: AshProviderWriteReceipt): Promise<void> {
  const found = await readReceipt(userData, expected.id)
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new AshHookOwnershipConflict('transaction receipt was changed during execution')
  }
  await unlink(receiptPath(userData, expected.id))
  await fsyncDirectory(join(userData, 'provider-hook-ownership'))
}

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
    id,
    configPath,
    beforeSha256: ashProviderFileSha256(args.expectedRaw),
    afterSha256: ashProviderFileSha256(nextRaw)!
  }
  await createReceipt(args.ashUserData, receipt)
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
  await finishReceipt(args.ashUserData, receipt)
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
  const receipt = await readReceipt(args.ashUserData, args.id)
  const snapshot = await readAshHookOwnershipLedger(args.ashUserData)
  const claim = snapshot.ledger.claims.find((value) => value.id === receipt.id)
  if (!claim || claim.configPath !== receipt.configPath || claim.provider !== 'claude') {
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
    await finishReceipt(args.ashUserData, receipt)
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
  await finishReceipt(args.ashUserData, receipt)
  return 'abandoned'
}
