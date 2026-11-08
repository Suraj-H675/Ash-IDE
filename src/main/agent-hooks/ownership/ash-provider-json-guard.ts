import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { lstat, link, open, rm, unlink } from 'node:fs/promises'
import { isPlainObject, parseHooksJsonText } from '../hooks-json-read'
import { AshHookOwnershipConflict } from './ash-hook-ownership-plan'
import { validateAshProviderParent, validateAshProviderTarget } from './ash-provider-path-policy'
import { withAshProviderLock } from './ash-provider-file-lock'

const MAX_CONFIG_BYTES = 1024 * 1024
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

type ExistingSnapshot = {
  raw: string
  config: Record<string, unknown>
  mode: number
  dev: bigint
  ino: bigint
  nlink: bigint
}

export type AshProviderJsonSnapshot = ExistingSnapshot | null

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function validOperationId(id: string): void {
  if (!UUID_V4.test(id)) {
    throw new AshHookOwnershipConflict('invalid provider-file operation identity')
  }
}

export function ashProviderFileSha256(raw: string | null): string | null {
  return raw === null ? null : createHash('sha256').update(raw).digest('hex')
}

export async function readAshProviderExisting(
  path: string,
  allowStagedHardlink = false
): Promise<AshProviderJsonSnapshot> {
  let before
  try {
    before = await lstat(path, { bigint: true })
  } catch (error) {
    if (isMissing(error)) {
      return null
    }
    throw error
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (before.nlink !== 1n && !(allowStagedHardlink && before.nlink === 2n))
  ) {
    throw new AshHookOwnershipConflict('provider settings file is symlinked, linked or not regular')
  }
  if (
    before.size > BigInt(MAX_CONFIG_BYTES) ||
    (process.getuid && before.uid !== BigInt(process.getuid()))
  ) {
    throw new AshHookOwnershipConflict('provider settings file is oversized or not user-owned')
  }
  const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await fd.stat({ bigint: true })
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== before.nlink) {
      throw new AshHookOwnershipConflict('provider settings file changed while being opened')
    }
    const raw = await fd.readFile({ encoding: 'utf8' })
    const after = await fd.stat({ bigint: true })
    if (
      Buffer.byteLength(raw) > MAX_CONFIG_BYTES ||
      opened.size !== after.size ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      opened.nlink !== after.nlink
    ) {
      throw new AshHookOwnershipConflict('provider settings file changed while being read')
    }
    const config = parseHooksJsonText(raw)
    if (!isPlainObject(config)) {
      throw new AshHookOwnershipConflict('provider settings file is not valid JSON configuration')
    }
    return {
      raw,
      config,
      mode: Number(opened.mode & 0o777n),
      ino: opened.ino,
      dev: opened.dev,
      nlink: opened.nlink
    }
  } finally {
    await fd.close()
  }
}

export async function readAshClaudeSettingsSnapshot(
  configPath: string
): Promise<AshProviderJsonSnapshot> {
  await validateAshProviderParent(configPath)
  return readAshProviderExisting(configPath)
}

export function heldPathForAshProviderSwap(configPath: string, operationId: string): string {
  validateAshProviderTarget(configPath)
  validOperationId(operationId)
  return `${configPath}.ash-ide-held-${operationId}`
}

export function stagedPathForAshProviderSwap(configPath: string, operationId: string): string {
  validateAshProviderTarget(configPath)
  validOperationId(operationId)
  return `${configPath}.ash-ide-stage-${operationId}.tmp`
}

export async function syncAshProviderParent(configPath: string): Promise<void> {
  const dir = await open(dirname(configPath), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0))
  try {
    await dir.sync()
  } finally {
    await dir.close()
  }
}

export async function restoreAshHeldProviderFile(
  configPath: string,
  heldPath: string
): Promise<void> {
  try {
    await link(heldPath, configPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new AshHookOwnershipConflict(
        'another writer published during Ash recovery; held file preserved'
      )
    }
    throw error
  }
  await unlink(heldPath)
  await syncAshProviderParent(configPath)
}

/**
 * Internal POSIX compare-and-swap primitive. The caller MUST first durably
 * stage its private Ash claim and transaction receipt. Not used by production
 * provider setup while the global hook-write policy is disabled.
 *
 * No existing file is blindly overwritten: after moving the original to a
 * recoverable held name, the replacement is published via link(O_EXCL).
 * Other applications do not necessarily honor Ash's advisory lock; an
 * uncooperative in-place edit may still race. Keep the release gate closed.
 */
export async function swapAshClaudeSettingsIfUnchanged(args: {
  configPath: string
  operationId: string
  expectedRaw: string | null
  nextRaw: string
  /** Test-only phase handshake for terminating the real guarded writer process. */
  testBoundary?: (
    phase:
      | 'stage-synced'
      | 'backup-linked'
      | 'original-held'
      | 'replacement-linked'
      | 'held-cleaned'
  ) => Promise<void>
}): Promise<void> {
  const { configPath, operationId } = args
  validOperationId(operationId)
  const nextConfig = parseHooksJsonText(args.nextRaw)
  if (!nextConfig || Buffer.byteLength(args.nextRaw) > MAX_CONFIG_BYTES) {
    throw new AshHookOwnershipConflict('replacement provider JSON is invalid or oversized')
  }
  await withAshProviderLock(configPath, operationId, async () => {
    const heldPath = heldPathForAshProviderSwap(configPath, operationId)
    const existingHeld = await lstat(heldPath).catch((error: unknown) => {
      if (isMissing(error)) {
        return null
      }
      throw error
    })
    if (existingHeld) {
      throw new AshHookOwnershipConflict('previous provider swap requires recovery')
    }
    const before = await readAshProviderExisting(configPath)
    if ((before?.raw ?? null) !== args.expectedRaw) {
      throw new AshHookOwnershipConflict('provider settings changed since plan creation')
    }
    // The prepared claim and receipt identify this stage file after a crash.
    // Unlike an untracked random temp name, its orphan can be verified safely.
    const tempPath = stagedPathForAshProviderSwap(configPath, operationId)
    let ownStage: { dev: bigint; ino: bigint } | null = null
    let backupLinked = false
    let moved = false
    let published = false
    try {
      const fd = await open(tempPath, 'wx', before?.mode ?? 0o600)
      const owned = await fd.stat({ bigint: true })
      ownStage = { dev: owned.dev, ino: owned.ino }
      try {
        await fd.writeFile(args.nextRaw, 'utf8')
        await fd.sync()
      } finally {
        await fd.close()
      }
      await args.testBoundary?.('stage-synced')
      if (before) {
        // link() fails with EEXIST; rename() could overwrite a recovery file
        // another process created after our initial existence check.
        await link(configPath, heldPath)
        backupLinked = true
        // Make the no-overwrite recovery name durable BEFORE removing the
        // original provider pathname; fsyncing only afterward is insufficient.
        await syncAshProviderParent(configPath)
        await args.testBoundary?.('backup-linked')
        const held = await readAshProviderExisting(heldPath, true)
        const current = await readAshProviderExisting(configPath, true)
        if (
          !held ||
          !current ||
          held.raw !== before.raw ||
          held.ino !== before.ino ||
          held.dev !== before.dev ||
          held.nlink !== 2n ||
          current.ino !== before.ino ||
          current.dev !== before.dev ||
          current.raw !== before.raw ||
          current.nlink !== 2n
        ) {
          throw new AshHookOwnershipConflict('provider settings changed during no-overwrite backup')
        }
        // This unlink still has an external-writer race: the two checks above
        // are not an atomic compare/unlink. Full SEC-04 remains gated.
        await unlink(configPath)
        moved = true
        await syncAshProviderParent(configPath)
        await args.testBoundary?.('original-held')
      }
      // link is a no-replace publication, unlike rename(temp, providerFile).
      await link(tempPath, configPath)
      published = true
      await syncAshProviderParent(configPath)
      await args.testBoundary?.('replacement-linked')
      if (moved) {
        await unlink(heldPath)
        await syncAshProviderParent(configPath)
        await args.testBoundary?.('held-cleaned')
      }
    } catch (error) {
      if (moved && !published) {
        await restoreAshHeldProviderFile(configPath, heldPath)
      } else if (backupLinked && !moved) {
        // The original may still share the backup inode. Only remove Ash's
        // own backup when both paths still match the exact expected content.
        const held = await readAshProviderExisting(heldPath, true)
        const current = await readAshProviderExisting(configPath, true)
        if (
          held &&
          current &&
          before &&
          held.nlink === 2n &&
          current.nlink === 2n &&
          held.ino === before.ino &&
          held.dev === before.dev &&
          current.ino === before.ino &&
          current.dev === before.dev &&
          held.raw === before.raw &&
          current.raw === before.raw
        ) {
          await unlink(heldPath)
          await syncAshProviderParent(configPath)
        } else {
          throw new AshHookOwnershipConflict('provider backup changed before cleanup')
        }
      }
      throw error
    } finally {
      if (ownStage) {
        const staged = await lstat(tempPath, { bigint: true }).catch((error: unknown) => {
          if (isMissing(error)) {
            return null
          }
          throw error
        })
        if (staged && staged.dev === ownStage.dev && staged.ino === ownStage.ino) {
          await rm(tempPath, { force: true })
        }
      }
    }
  })
}
