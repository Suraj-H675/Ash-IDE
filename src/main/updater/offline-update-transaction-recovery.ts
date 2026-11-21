import { join } from 'node:path'
import type {
  OfflineUpdateFence,
  OfflineUpdateGeneration,
  OfflineUpdateRecoveryResult,
  OfflineUpdateBoundary
} from './offline-update-transaction-types'
import { assertFenceForRoots } from './offline-update-transaction-fence'
import { requireLinux, requirePrivateDirectory } from './offline-update-transaction-paths'
import {
  readJournal,
  readActivePointer,
  transactionDirectory,
  writeActiveGenerationPointer
} from './offline-update-transaction-journal'
import {
  removeJournalStagingDirectories,
  syncDirectoryStrict,
  writeJsonDurably
} from './offline-update-transaction-files'
import { verifyGeneration } from './offline-update-transaction-generation'

export function recoverOfflineUpdateTransaction(
  installRootPath: string,
  dataRootPath: string,
  fence: OfflineUpdateFence
): OfflineUpdateRecoveryResult {
  requireLinux()
  const installRoot = requirePrivateDirectory(installRootPath)
  const dataRoot = requirePrivateDirectory(dataRootPath)
  assertFenceForRoots(fence, installRoot, dataRoot)
  const controlRoot = transactionDirectory(dataRoot)
  const journal = readJournal(controlRoot)
  const active = readActivePointer(controlRoot)
  if (!journal) {
    const result = {
      state: 'no-transaction' as const,
      activeGeneration: active
        ? verifyGeneration(
            installRoot,
            dataRoot,
            active.generationId,
            active.artifactSha256,
            active.stateManifestSha256
          )
        : null
    }
    syncDirectoryStrict(controlRoot)
    return result
  }
  const activeId = active?.generationId ?? null
  if (activeId === journal.candidateGenerationId) {
    if (journal.phase === 'rolling-back' || journal.phase === 'rolled-back') {
      if (!journal.previousGenerationId) {
        throw new Error('Offline update rollback journal has no previous generation')
      }
      const previous = verifyGeneration(installRoot, dataRoot, journal.previousGenerationId)
      fence.assertActive()
      writeActiveGenerationPointer(controlRoot, previous)
      writeJsonDurably(join(controlRoot, 'transaction.json'), { ...journal, phase: 'rolled-back' })
      syncDirectoryStrict(controlRoot)
      removeJournalStagingDirectories(installRoot, dataRoot, journal)
      syncDirectoryStrict(controlRoot)
      return { state: 'previous-generation-active', activeGeneration: previous }
    }
    const generation = verifyGeneration(
      installRoot,
      dataRoot,
      journal.candidateGenerationId,
      journal.artifactSha256,
      journal.stateManifestSha256
    )
    if (journal.phase !== 'committed') {
      fence.assertActive()
      writeJsonDurably(join(controlRoot, 'transaction.json'), { ...journal, phase: 'committed' })
    }
    removeJournalStagingDirectories(installRoot, dataRoot, journal)
    syncDirectoryStrict(controlRoot)
    return { state: 'candidate-generation-active', activeGeneration: generation }
  }
  if (activeId === journal.previousGenerationId) {
    if (journal.phase === 'committed') {
      throw new Error(
        'Offline update journal says committed while the previous generation is active'
      )
    }
    const previous = active
      ? verifyGeneration(
          installRoot,
          dataRoot,
          active.generationId,
          active.artifactSha256,
          active.stateManifestSha256
        )
      : null
    if (journal.phase !== 'rolled-back') {
      fence.assertActive()
      writeJsonDurably(join(controlRoot, 'transaction.json'), { ...journal, phase: 'rolled-back' })
    }
    removeJournalStagingDirectories(installRoot, dataRoot, journal)
    syncDirectoryStrict(controlRoot)
    return { state: 'previous-generation-active', activeGeneration: previous }
  }
  throw new Error(
    'Offline update recovery cannot identify the active generation; manual recovery is required'
  )
}

/** Storage-level rollback only. It does not switch the running Ash binary or data roots. */
export function rollbackOfflineUpdateTransaction(
  installRootPath: string,
  dataRootPath: string,
  fence: OfflineUpdateFence,
  onBoundary?: (boundary: OfflineUpdateBoundary) => void
): OfflineUpdateGeneration {
  requireLinux()
  const installRoot = requirePrivateDirectory(installRootPath)
  const dataRoot = requirePrivateDirectory(dataRootPath)
  assertFenceForRoots(fence, installRoot, dataRoot)
  const controlRoot = transactionDirectory(dataRoot)
  const journal = readJournal(controlRoot)
  const active = readActivePointer(controlRoot)
  if (
    journal?.phase === 'rolled-back' &&
    journal.previousGenerationId &&
    active?.generationId === journal.previousGenerationId
  ) {
    const previous = verifyGeneration(installRoot, dataRoot, journal.previousGenerationId)
    syncDirectoryStrict(controlRoot)
    return previous
  }
  if (!journal || journal.phase !== 'committed' || !journal.previousGenerationId) {
    throw new Error(
      'Offline update rollback requires a committed generation with a retained previous slot'
    )
  }
  if (active?.generationId !== journal.candidateGenerationId) {
    throw new Error('Offline update rollback found an unexpected active generation')
  }
  if (
    active.artifactSha256 !== journal.artifactSha256 ||
    active.stateManifestSha256 !== journal.stateManifestSha256
  ) {
    throw new Error('Offline update rollback found a pointer that does not match its journal')
  }
  verifyGeneration(
    installRoot,
    dataRoot,
    journal.candidateGenerationId,
    journal.artifactSha256,
    journal.stateManifestSha256
  )
  const previous = verifyGeneration(installRoot, dataRoot, journal.previousGenerationId)
  fence.assertActive()
  writeJsonDurably(join(controlRoot, 'transaction.json'), { ...journal, phase: 'rolling-back' })
  onBoundary?.('rollback-journal-durable')
  fence.assertActive()
  writeActiveGenerationPointer(controlRoot, previous)
  onBoundary?.('rollback-pointer-durable')
  writeJsonDurably(join(controlRoot, 'transaction.json'), { ...journal, phase: 'rolled-back' })
  onBoundary?.('rollback-journal-committed')
  syncDirectoryStrict(controlRoot)
  return previous
}
