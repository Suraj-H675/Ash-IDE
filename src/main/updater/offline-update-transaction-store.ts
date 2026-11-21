import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { MAX_ARTIFACT_BYTES, MAX_RETAINED_GENERATIONS } from './offline-update-transaction-limits'
import type {
  ActiveGenerationPointer,
  OfflineUpdateGeneration,
  StoreOfflineUpdateGenerationOptions,
  TransactionJournal
} from './offline-update-transaction-types'
import { assertManifestMatchesPolicy } from './offline-update-transaction-policy'
import { captureOfflineUpdateStateManifest } from './offline-update-transaction-inventory'
import { assertFenceForRoots } from './offline-update-transaction-fence'
import {
  hashOwnedFile,
  requireLinux,
  requirePrivateDirectory
} from './offline-update-transaction-paths'
import {
  readJournal,
  readActivePointer,
  hashJson,
  transactionDirectory,
  slotDirectory
} from './offline-update-transaction-journal'
import { writeJsonDurably, syncDirectoryStrict } from './offline-update-transaction-files'
import {
  verifyGeneration,
  stageBinaryGeneration,
  stageStateGeneration
} from './offline-update-transaction-generation'

function assertRetainedGenerationCapacity(
  binarySlots: string,
  stateGenerations: string,
  nextId: string
): void {
  // Count orphaned and interrupted slots too; never silently prune recovery data.
  const names = new Set([...readdirSync(binarySlots), ...readdirSync(stateGenerations)])
  if (names.size >= MAX_RETAINED_GENERATIONS && !names.has(nextId)) {
    throw new Error('Offline update retained generation limit reached; verified pruning required')
  }
}

function assertCompletedJournalMatchesPointer(
  journal: TransactionJournal | null,
  current: ActiveGenerationPointer | null
): void {
  if (!journal) {
    return
  }
  if (journal.phase === 'committed') {
    if (
      current?.generationId !== journal.candidateGenerationId ||
      current.artifactSha256 !== journal.artifactSha256 ||
      current.stateManifestSha256 !== journal.stateManifestSha256
    ) {
      throw new Error(
        'Offline update committed journal and active pointer disagree; recovery required'
      )
    }
  } else if (
    journal.phase === 'rolled-back' &&
    (current?.generationId ?? null) !== journal.previousGenerationId
  ) {
    throw new Error(
      'Offline update rolled-back journal and active pointer disagree; recovery required'
    )
  }
}

export function storeOfflineUpdateGeneration(
  options: StoreOfflineUpdateGenerationOptions
): OfflineUpdateGeneration {
  requireLinux()
  const installRoot = requirePrivateDirectory(options.installRoot)
  const dataRoot = requirePrivateDirectory(options.dataRoot)
  const fence = options.fence
  if (
    installRoot === dataRoot ||
    installRoot.startsWith(`${dataRoot}${sep}`) ||
    dataRoot.startsWith(`${installRoot}${sep}`)
  ) {
    throw new Error('Offline update install and data roots must be distinct')
  }
  assertFenceForRoots(fence, installRoot, dataRoot)
  if (!/^[a-f0-9]{64}$/u.test(options.artifactSha256)) {
    throw new Error('Offline update AppImage SHA-256 is malformed')
  }
  const artifact = hashOwnedFile(options.artifactPath, MAX_ARTIFACT_BYTES)
  if (artifact.sha256 !== options.artifactSha256) {
    throw new Error('Offline update AppImage does not match its approved digest')
  }
  const stateManifest = captureOfflineUpdateStateManifest(dataRoot, options.statePolicy)
  assertManifestMatchesPolicy(options.statePolicy, stateManifest)
  const stateManifestSha256 = hashJson(stateManifest)
  const generationId = hashJson({ artifactSha256: artifact.sha256, stateManifestSha256 })
  const controlRoot = transactionDirectory(dataRoot)
  const binarySlots = slotDirectory(installRoot, 'binary')
  const stateGenerations = slotDirectory(dataRoot, 'state')
  const previousJournal = readJournal(controlRoot)
  if (
    previousJournal &&
    ['preparing', 'prepared', 'rolling-back'].includes(previousJournal.phase)
  ) {
    throw new Error('Recover the interrupted offline update transaction before retrying')
  }
  const current = readActivePointer(controlRoot)
  assertCompletedJournalMatchesPointer(previousJournal, current)
  assertRetainedGenerationCapacity(binarySlots, stateGenerations, generationId)
  if (current) {
    verifyGeneration(
      installRoot,
      dataRoot,
      current.generationId,
      current.artifactSha256,
      current.stateManifestSha256
    )
  }
  if (current?.generationId === generationId) {
    const generation = verifyGeneration(
      installRoot,
      dataRoot,
      generationId,
      artifact.sha256,
      stateManifestSha256
    )
    syncDirectoryStrict(controlRoot)
    return generation
  }
  const previousGenerationId = current?.generationId ?? null
  const transactionId = randomUUID()
  let journal: TransactionJournal = {
    schema: 1,
    transactionId,
    previousGenerationId,
    candidateGenerationId: generationId,
    artifactSha256: artifact.sha256,
    stateManifestSha256,
    phase: 'preparing'
  }
  fence.assertActive()
  writeJsonDurably(join(controlRoot, 'transaction.json'), journal)
  options.onBoundary?.('journal-preparing')
  stageBinaryGeneration({
    binarySlots,
    generationId,
    transactionId,
    artifactPath: options.artifactPath,
    artifactSha256: artifact.sha256,
    artifactSize: artifact.size
  })
  fence.assertActive()
  options.onBoundary?.('binary-slot-durable')
  stageStateGeneration({
    stateGenerations,
    generationId,
    transactionId,
    dataRoot,
    statePolicy: options.statePolicy,
    stateManifest,
    stateManifestSha256
  })
  fence.assertActive()
  options.onBoundary?.('state-slot-durable')
  journal = { ...journal, phase: 'prepared' }
  writeJsonDurably(join(controlRoot, 'transaction.json'), journal)
  options.onBoundary?.('journal-prepared')
  const stillCurrent = readActivePointer(controlRoot)
  if ((stillCurrent?.generationId ?? null) !== previousGenerationId) {
    throw new Error('Offline update active generation changed during the transaction')
  }
  verifyGeneration(installRoot, dataRoot, generationId, artifact.sha256, stateManifestSha256)
  fence.assertActive()
  writeJsonDurably(join(controlRoot, 'active-generation.json'), {
    schema: 1,
    generationId,
    artifactSha256: artifact.sha256,
    stateManifestSha256
  })
  options.onBoundary?.('pointer-durable')
  journal = { ...journal, phase: 'committed' }
  writeJsonDurably(join(controlRoot, 'transaction.json'), journal)
  options.onBoundary?.('journal-committed')
  syncDirectoryStrict(controlRoot)
  return verifyGeneration(installRoot, dataRoot, generationId, artifact.sha256, stateManifestSha256)
}
