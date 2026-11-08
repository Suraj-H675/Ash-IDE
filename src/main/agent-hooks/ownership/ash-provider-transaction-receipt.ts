import { constants } from 'node:fs'
import { join, isAbsolute, basename } from 'node:path'
import { lstat, open, unlink } from 'node:fs/promises'
import { AshHookOwnershipConflict } from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger } from './ash-hook-ownership-store'

const SHA256 = /^[0-9a-f]{64}$/
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const MAX_RECEIPT_BYTES = 4096

export type AshProviderWriteReceipt = {
  schemaVersion: 1
  owner: 'ash-ide'
  provider: 'claude'
  action: 'install' | 'remove'
  id: string
  operationId: string
  definitionSha256: string
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
    !('action' in raw) ||
    (raw.action !== 'install' && raw.action !== 'remove') ||
    !('operationId' in raw) ||
    typeof raw.operationId !== 'string' ||
    !UUID_V4.test(raw.operationId) ||
    !('definitionSha256' in raw) ||
    typeof raw.definitionSha256 !== 'string' ||
    !SHA256.test(raw.definitionSha256) ||
    !('id' in raw) ||
    typeof raw.id !== 'string' ||
    !UUID_V4.test(raw.id) ||
    !('configPath' in raw) ||
    typeof raw.configPath !== 'string' ||
    !isAbsolute(raw.configPath) ||
    basename(raw.configPath) !== 'settings.json' ||
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

export async function readAshProviderWriteReceipt(
  userData: string,
  id: string
): Promise<AshProviderWriteReceipt> {
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

export async function createAshProviderWriteReceipt(
  userData: string,
  receipt: AshProviderWriteReceipt
): Promise<void> {
  validReceipt(receipt)
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

export async function finishAshProviderWriteReceipt(
  userData: string,
  expected: AshProviderWriteReceipt
): Promise<void> {
  const found = await readAshProviderWriteReceipt(userData, expected.id)
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new AshHookOwnershipConflict('transaction receipt was changed during execution')
  }
  await unlink(receiptPath(userData, expected.id))
  await fsyncDirectory(join(userData, 'provider-hook-ownership'))
}
