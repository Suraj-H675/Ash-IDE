import { randomUUID } from 'node:crypto'
import { constants, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getAshManagedHookArtifactPath } from '../agent-hooks/ash-managed-hook-artifact-path'

const ownerToken = randomUUID()
const OWNER_FILE_PATTERN = /^owner-([\da-f-]{36})\.json$/i
const MAX_OWNER_BYTES = 4096

type GrokHookOwner = { token: string; pid: number }

function ownerDirectory(): string {
  return getAshManagedHookArtifactPath('grok-owners', 'directory')
}

function ownerPath(directory = ownerDirectory()): string {
  return join(directory, `owner-${ownerToken}.json`)
}

function assertOwnOwnerRecord(path: string): void {
  const state = lstatSync(path)
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1) {
    throw new Error('ash_grok_owner_record_not_private')
  }
  let record: GrokHookOwner
  try {
    record = JSON.parse(readFileSync(path, 'utf8')) as GrokHookOwner
  } catch {
    throw new Error('ash_grok_owner_record_invalid')
  }
  if (record.token !== ownerToken || record.pid !== process.pid) {
    throw new Error('ash_grok_owner_record_not_ours')
  }
}

export function registerGrokHookOwner(): void {
  const directory = ownerDirectory()
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  // Resolve again after mkdir, refusing a newly linked or foreign directory.
  ownerDirectory()
  try {
    writeFileSync(
      ownerPath(directory),
      `${JSON.stringify({ token: ownerToken, pid: process.pid } satisfies GrokHookOwner)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // Repeated registration is safe only when the exact own record survived.
      assertOwnOwnerRecord(ownerPath(directory))
      return
    }
    throw error
  }
}

export function unregisterGrokHookOwnerSync(): void {
  const path = ownerPath()
  try {
    assertOwnOwnerRecord(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  rmSync(path, { force: true })
}

export async function releaseGrokHookOwnerAndCheckForPeers(): Promise<boolean> {
  const directory = ownerDirectory()
  unregisterGrokHookOwnerSync()
  return await hasLivePeer(directory, ownerToken, probeProcess)
}

/** Fast second check after liveness pruning closes the registration race before cleanup commits. */
export async function hasRegisteredGrokHookOwner(directory = ownerDirectory()): Promise<boolean> {
  try {
    return (await readdir(directory)).some((entry) => OWNER_FILE_PATTERN.test(entry))
  } catch (error) {
    // Why: unverifiable ownership must preserve the shared hook, never delete it.
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

export async function hasLivePeer(
  directory: string,
  currentToken: string,
  probe: (pid: number) => Promise<boolean | undefined>
): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    // Why: unverifiable ownership must preserve the shared hook, never delete it.
    return true
  }

  for (const entry of entries) {
    const token = OWNER_FILE_PATTERN.exec(entry)?.[1]
    if (!token || token === currentToken) {
      continue
    }
    const path = join(directory, entry)
    const owner = await readPrivatePeer(path, token)
    if (!owner) {
      // Unverifiable records remain untouched and prevent global hook cleanup.
      return true
    }
    await probe(owner.pid)
    // A stale peer requires explicit review, not automatic deletion. All
    // outcomes conservatively prevent an unowned provider-global cleanup.
    return true
  }
  return false
}

/** Do not follow another application's link or read an unbounded peer file. */
async function readPrivatePeer(path: string, token: string): Promise<GrokHookOwner | null> {
  try {
    const before = await lstat(path, { bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX_OWNER_BYTES) ||
      (process.platform !== 'win32' && process.getuid && before.uid !== BigInt(process.getuid()))
    ) {
      return null
    }
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const first = await file.stat({ bigint: true })
      if (
        first.dev !== before.dev ||
        first.ino !== before.ino ||
        first.nlink !== 1n ||
        first.size !== before.size
      ) {
        return null
      }
      const bytes = Buffer.alloc(MAX_OWNER_BYTES + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      const after = await file.stat({ bigint: true })
      if (
        BigInt(bytesRead) !== first.size ||
        after.size !== first.size ||
        after.mtimeNs !== first.mtimeNs ||
        after.ctimeNs !== first.ctimeNs ||
        after.nlink !== 1n
      ) {
        return null
      }
      const record = JSON.parse(bytes.toString('utf8', 0, bytesRead)) as Partial<GrokHookOwner>
      if (record.token === token && Number.isSafeInteger(record.pid) && (record.pid ?? 0) > 1) {
        return record as GrokHookOwner
      }
    } finally {
      await file.close()
    }
  } catch {
    // No error here grants permission to mutate a provider-global hook.
  }
  return null
}

async function probeProcess(pid: number): Promise<boolean | undefined> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : undefined
  }
}
