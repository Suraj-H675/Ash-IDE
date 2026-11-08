import { constants } from 'node:fs'
import { lstat, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AshHookOwnershipConflict } from './ash-hook-ownership-plan'
import { validateAshProviderParent } from './ash-provider-path-policy'

const LOCK_SCHEMA = 1
// A valid provider settings path can be up to 4096 bytes; include room for
// its JSON metadata so every successfully written lock can be recovered.
const MAX_LOCK_BYTES = 8192
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

export function ashProviderWriterLockPath(configPath: string): string {
  return `${configPath}.ash-ide-write.lock`
}

function validOperationId(id: string): void {
  if (!UUID_V4.test(id)) {
    throw new AshHookOwnershipConflict('invalid provider lock operation identity')
  }
}

async function syncParent(path: string): Promise<void> {
  const dir = await open(dirname(path), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
  try {
    await dir.sync()
  } finally {
    await dir.close()
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Cooperative POSIX lock for this one Ash provider settings file. The record
 * is durable before the writer changes provider JSON. A crash before this
 * record is fully written intentionally leaves a lock requiring manual review.
 * No process is terminated or signalled except the nonmutating PID probe.
 */
export async function withAshProviderLock<T>(
  configPath: string,
  operationId: string,
  run: () => Promise<T>
): Promise<T> {
  validOperationId(operationId)
  await validateAshProviderParent(configPath)
  const lockPath = ashProviderWriterLockPath(configPath)
  let fd
  try {
    fd = await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new AshHookOwnershipConflict('provider file is locked by another Ash writer')
    }
    throw error
  }
  const owner = await fd.stat({ bigint: true })
  let written: typeof owner | null = null
  try {
    await fd.writeFile(
      `${JSON.stringify({ schemaVersion: LOCK_SCHEMA, owner: 'ash-ide', operationId, configPath, pid: process.pid })}\n`,
      'utf8'
    )
    await fd.sync()
    await syncParent(lockPath)
    written = await fd.stat({ bigint: true })
    return await run()
  } finally {
    await fd.close()
    const current = await lstat(lockPath, { bigint: true }).catch((error: unknown) => {
      if (isMissing(error)) {
        return null
      }
      throw error
    })
    // Never unlink another writer's lock after a race or failed operation.
    const expected = written ?? owner
    if (
      current &&
      current.ino === expected.ino &&
      current.dev === expected.dev &&
      current.size === expected.size &&
      current.ctimeNs === expected.ctimeNs &&
      current.mtimeNs === expected.mtimeNs &&
      current.nlink === 1n
    ) {
      await unlink(lockPath)
      await syncParent(lockPath)
    }
  }
}

/**
 * Reclaim ONLY a verified dead writer with the exact journal operation ID.
 * Callers must validate the Ash-private claim and receipt before invoking it.
 * Ambiguous, legacy empty, foreign, symlinked and LIVE locks are not removed.
 * A recycled PID is treated as live (safe, though it may block recovery).
 */
export async function reclaimDeadAshProviderWriterLock(
  configPath: string,
  operationId: string
): Promise<'absent' | 'reclaimed'> {
  validOperationId(operationId)
  await validateAshProviderParent(configPath)
  const lockPath = ashProviderWriterLockPath(configPath)
  const initial = await lstat(lockPath, { bigint: true }).catch((error: unknown) => {
    if (isMissing(error)) {
      return null
    }
    throw error
  })
  if (!initial) {
    return 'absent'
  }
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.nlink !== 1n ||
    initial.size > BigInt(MAX_LOCK_BYTES) ||
    (initial.mode & 0o077n) !== 0n ||
    (process.getuid && initial.uid !== BigInt(process.getuid()))
  ) {
    throw new AshHookOwnershipConflict('provider writer lock has unsafe ownership or file type')
  }
  const fd = await open(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await fd.stat({ bigint: true })
    if (
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino ||
      opened.nlink !== 1n ||
      opened.size !== initial.size ||
      opened.ctimeNs !== initial.ctimeNs ||
      opened.mtimeNs !== initial.mtimeNs
    ) {
      throw new AshHookOwnershipConflict('provider writer lock changed while opening')
    }
    const raw = await fd.readFile('utf8')
    const after = await fd.stat({ bigint: true })
    if (
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      after.nlink !== opened.nlink
    ) {
      throw new AshHookOwnershipConflict('provider writer lock changed while being read')
    }
    if (Buffer.byteLength(raw) > MAX_LOCK_BYTES) {
      throw new AshHookOwnershipConflict('provider writer lock is too large')
    }
    let record: unknown
    try {
      record = JSON.parse(raw)
    } catch {
      throw new AshHookOwnershipConflict('provider writer lock is unreadable')
    }
    if (
      !record ||
      typeof record !== 'object' ||
      !('schemaVersion' in record) ||
      record.schemaVersion !== LOCK_SCHEMA ||
      !('owner' in record) ||
      record.owner !== 'ash-ide' ||
      !('operationId' in record) ||
      record.operationId !== operationId ||
      !('configPath' in record) ||
      record.configPath !== configPath ||
      !('pid' in record) ||
      typeof record.pid !== 'number' ||
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 1
    ) {
      throw new AshHookOwnershipConflict('provider writer lock does not match this Ash operation')
    }
    try {
      // Does not send a signal; protects live owners (including reused PIDs).
      process.kill(record.pid, 0)
      throw new AshHookOwnershipConflict('provider writer process is still live')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        throw error
      }
    }
    const current = await lstat(lockPath, { bigint: true })
    if (
      current.dev !== initial.dev ||
      current.ino !== initial.ino ||
      current.nlink !== 1n ||
      current.size !== after.size ||
      current.ctimeNs !== after.ctimeNs ||
      current.mtimeNs !== after.mtimeNs
    ) {
      throw new AshHookOwnershipConflict('provider writer lock changed before reclamation')
    }
    await unlink(lockPath)
    await syncParent(lockPath)
    return 'reclaimed'
  } finally {
    await fd.close()
  }
}
