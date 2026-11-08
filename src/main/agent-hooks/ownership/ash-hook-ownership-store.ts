import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  AshHookOwnershipConflict,
  emptyAshHookOwnershipLedger,
  validateAshHookOwnershipLedger,
  type AshHookOwnershipLedger
} from './ash-hook-ownership-plan'

// All records live under Ash's private userData, never under ~/.claude, ~/.codex or ~/.orca.
const LEDGER_DIR = 'provider-hook-ownership'
const LEDGER_NAME = 'claims.v1.json'
const LOCK_NAME = 'claims.lock'
const MAX_LEDGER_BYTES = 256 * 1024

export type AshHookLedgerSnapshot = {
  ledger: AshHookOwnershipLedger
  /** Compare-and-swap revision. Null only when the private ledger file is absent. */
  revision: string | null
}

function revision(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function requirePrivateDirectory(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new AshHookOwnershipConflict('private ledger path is not a real directory')
  }
  if (process.platform !== 'win32' && (entry.mode & 0o077) !== 0) {
    throw new AshHookOwnershipConflict('private ledger directory is accessible by other users')
  }
}

async function ledgerDirectory(ashUserData: string): Promise<string> {
  if (!isAbsolute(ashUserData)) {
    throw new AshHookOwnershipConflict('Ash userData path must be absolute')
  }
  // Never create or chmod the caller's data root, and never cross a symlinked root.
  const root = await lstat(ashUserData)
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new AshHookOwnershipConflict('Ash userData is not a real directory')
  }
  if (process.platform !== 'win32' && (root.mode & 0o077) !== 0) {
    throw new AshHookOwnershipConflict('Ash userData root is accessible by other users')
  }
  const path = join(ashUserData, LEDGER_DIR)
  await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error
    }
  })
  await requirePrivateDirectory(path)
  return path
}

async function readAt(path: string): Promise<AshHookLedgerSnapshot> {
  const target = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) {
      return null
    }
    throw error
  })
  if (target?.isSymbolicLink()) {
    throw new AshHookOwnershipConflict('symlinked ownership ledger is not trusted')
  }
  let file
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (isMissing(error)) {
      return { ledger: emptyAshHookOwnershipLedger(), revision: null }
    }
    throw error
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_LEDGER_BYTES) {
      throw new AshHookOwnershipConflict('ledger file is not a regular bounded file')
    }
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      throw new AshHookOwnershipConflict('ledger file exposes provider configuration metadata')
    }
    const raw = await file.readFile({ encoding: 'utf8' })
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new AshHookOwnershipConflict('ledger file is unreadable JSON')
    }
    return { ledger: validateAshHookOwnershipLedger(value), revision: revision(raw) }
  } finally {
    await file.close()
  }
}

export async function readAshHookOwnershipLedger(
  ashUserData: string
): Promise<AshHookLedgerSnapshot> {
  const dir = await ledgerDirectory(ashUserData)
  return readAt(join(dir, LEDGER_NAME))
}

/**
 * Persists only Ash claim metadata, with private file permissions, a local
 * exclusive lock, and an expected-revision check. A failed write never
 * rewrites the previous ledger; stale locks intentionally fail closed.
 * Does NOT write provider configuration or grant permission to install hooks.
 */
export async function saveAshHookOwnershipLedger(
  ashUserData: string,
  next: unknown,
  expectedRevision: string | null
): Promise<AshHookLedgerSnapshot> {
  const ledger = validateAshHookOwnershipLedger(next)
  if (expectedRevision !== null && !/^[\da-f]{64}$/.test(expectedRevision)) {
    throw new AshHookOwnershipConflict('invalid expected ledger revision')
  }
  const dir = await ledgerDirectory(ashUserData)
  const lockPath = join(dir, LOCK_NAME)
  const tmpPath = join(dir, `${LEDGER_NAME}.${randomUUID()}.tmp`)
  let lock
  try {
    lock = await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new AshHookOwnershipConflict('ledger is locked by another writer')
    }
    throw error
  }
  try {
    const current = await readAt(join(dir, LEDGER_NAME))
    if (current.revision !== expectedRevision) {
      throw new AshHookOwnershipConflict('ledger changed since it was read')
    }
    const raw = `${JSON.stringify(ledger, null, 2)}\n`
    if (Buffer.byteLength(raw) > MAX_LEDGER_BYTES) {
      throw new AshHookOwnershipConflict('ledger exceeds maximum private file size')
    }
    const temp = await open(tmpPath, 'wx', 0o600)
    try {
      await temp.writeFile(raw, { encoding: 'utf8' })
      await temp.sync()
    } finally {
      await temp.close()
    }
    await rename(tmpPath, join(dir, LEDGER_NAME))
    return { ledger, revision: revision(raw) }
  } finally {
    await rm(tmpPath, { force: true })
    await lock.close()
    await rm(lockPath, { force: true })
  }
}
