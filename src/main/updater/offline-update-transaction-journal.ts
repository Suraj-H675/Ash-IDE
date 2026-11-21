import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type {
  ActiveGenerationPointer,
  OfflineUpdateGeneration,
  TransactionJournal
} from './offline-update-transaction-types'
import {
  createPrivateChildDirectory,
  readSmallJson,
  writeJsonDurably
} from './offline-update-transaction-files'

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function transactionDirectory(dataRoot: string): string {
  return createPrivateChildDirectory(dataRoot, '.ash-offline-update')
}

export function slotDirectory(root: string, category: 'binary' | 'state'): string {
  const controlDirectory = createPrivateChildDirectory(root, '.ash-offline-update')
  return createPrivateChildDirectory(
    controlDirectory,
    category === 'binary' ? 'slots' : 'generations'
  )
}

export function readActivePointer(controlRoot: string): ActiveGenerationPointer | null {
  const value = readSmallJson<ActiveGenerationPointer>(join(controlRoot, 'active-generation.json'))
  if (value === null) {
    return null
  }
  if (
    value.schema !== 1 ||
    !/^[a-f0-9]{64}$/u.test(value.generationId) ||
    !/^[a-f0-9]{64}$/u.test(value.artifactSha256) ||
    !/^[a-f0-9]{64}$/u.test(value.stateManifestSha256)
  ) {
    throw new Error('Offline update active-generation pointer is malformed')
  }
  return value
}

export function readJournal(controlRoot: string): TransactionJournal | null {
  const value = readSmallJson<TransactionJournal>(join(controlRoot, 'transaction.json'))
  if (value === null) {
    return null
  }
  if (
    value.schema !== 1 ||
    !/^[a-f0-9-]{36}$/u.test(value.transactionId) ||
    !/^[a-f0-9]{64}$/u.test(value.candidateGenerationId) ||
    (value.previousGenerationId !== null && !/^[a-f0-9]{64}$/u.test(value.previousGenerationId)) ||
    !/^[a-f0-9]{64}$/u.test(value.artifactSha256) ||
    !/^[a-f0-9]{64}$/u.test(value.stateManifestSha256) ||
    !['preparing', 'prepared', 'committed', 'rolling-back', 'rolled-back'].includes(value.phase)
  ) {
    throw new Error('Offline update transaction journal is malformed')
  }
  return value
}

export function writeActiveGenerationPointer(
  controlRoot: string,
  generation: OfflineUpdateGeneration
): void {
  writeJsonDurably(join(controlRoot, 'active-generation.json'), {
    schema: 1,
    generationId: generation.generationId,
    artifactSha256: generation.artifactSha256,
    stateManifestSha256: generation.stateManifestSha256
  } satisfies ActiveGenerationPointer)
}
