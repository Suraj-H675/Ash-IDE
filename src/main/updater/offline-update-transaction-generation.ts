import { lstatSync, readdirSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MAX_ARTIFACT_BYTES, MAX_STATE_MANIFEST_BYTES } from './offline-update-transaction-limits'
import type {
  OfflineUpdateGeneration,
  OfflineUpdateStateManifest,
  OfflineUpdateStatePolicy
} from './offline-update-transaction-types'
import { validateGenerationId } from './offline-update-transaction-policy'
import { hashOwnedFile, missing, requirePrivateDirectory } from './offline-update-transaction-paths'
import {
  createPrivateChildDirectory,
  readSmallJson,
  renameDurablyStrict,
  removeStagingDirectoryIfPresent,
  syncDirectoryStrict,
  syncPath
} from './offline-update-transaction-files'
import {
  copyArtifact,
  copyStateManifest,
  verifyStateSnapshot
} from './offline-update-transaction-snapshot'
import { hashJson, slotDirectory } from './offline-update-transaction-journal'

export function verifyGeneration(
  installRoot: string,
  dataRoot: string,
  generationId: string,
  expectedArtifactSha256?: string,
  expectedStateManifestSha256?: string
): OfflineUpdateGeneration {
  validateGenerationId(generationId)
  const binaryGeneration = join(slotDirectory(installRoot, 'binary'), generationId)
  requirePrivateDirectory(binaryGeneration)
  const artifactPath = join(binaryGeneration, 'ash-ide.AppImage')
  const artifact = hashOwnedFile(artifactPath, MAX_ARTIFACT_BYTES)
  const statePath = join(slotDirectory(dataRoot, 'state'), generationId)
  requirePrivateDirectory(statePath)
  const manifest = readSmallJson<OfflineUpdateStateManifest>(
    join(statePath, 'state-manifest.json'),
    MAX_STATE_MANIFEST_BYTES
  )
  if (!manifest) {
    throw new Error('Offline update generation has no complete state manifest')
  }
  const stateManifestSha256 = hashJson(manifest)
  if (hashJson({ artifactSha256: artifact.sha256, stateManifestSha256 }) !== generationId) {
    throw new Error('Offline update generation ID does not match its stored binary and state')
  }
  if (
    (expectedArtifactSha256 !== undefined && artifact.sha256 !== expectedArtifactSha256) ||
    (expectedStateManifestSha256 !== undefined &&
      stateManifestSha256 !== expectedStateManifestSha256)
  ) {
    throw new Error('Offline update generation bytes do not match the journal')
  }
  verifyStateSnapshot(statePath, manifest)
  syncDirectoryStrict(dirname(binaryGeneration))
  syncDirectoryStrict(dirname(statePath))
  return {
    generationId,
    artifactSha256: artifact.sha256,
    stateManifestSha256,
    artifactPath,
    statePath
  }
}

export function stageBinaryGeneration(options: {
  binarySlots: string
  generationId: string
  transactionId: string
  artifactPath: string
  artifactSha256: string
  artifactSize: number
}): void {
  const binaryGeneration = join(options.binarySlots, options.generationId)
  try {
    const existingDirectory = lstatSync(binaryGeneration)
    if (!existingDirectory.isDirectory() || existingDirectory.isSymbolicLink()) {
      throw new Error('Existing offline update binary slot is not a real directory')
    }
    requirePrivateDirectory(binaryGeneration)
    if (
      JSON.stringify(readdirSync(binaryGeneration).sort()) !== JSON.stringify(['ash-ide.AppImage'])
    ) {
      throw new Error('Existing offline update binary slot is incomplete or has unexpected entries')
    }
    const existing = hashOwnedFile(join(binaryGeneration, 'ash-ide.AppImage'), MAX_ARTIFACT_BYTES)
    if (existing.sha256 !== options.artifactSha256 || existing.size !== options.artifactSize) {
      throw new Error('Existing offline update binary slot has different bytes')
    }
    chmodSync(binaryGeneration, 0o500)
    syncPath(binaryGeneration, true)
  } catch (error) {
    if (!missing(error)) {
      throw error
    }
    const stagingName = `${options.generationId}.staging-${options.transactionId}`
    const staging = createPrivateChildDirectory(options.binarySlots, stagingName)
    try {
      const stagedArtifact = join(staging, 'ash-ide.AppImage')
      copyArtifact(options.artifactPath, options.artifactSha256, stagedArtifact)
      chmodSync(stagedArtifact, 0o500)
      syncPath(stagedArtifact)
      syncDirectoryStrict(staging)
      chmodSync(staging, 0o500)
      syncPath(staging, true)
      renameDurablyStrict(staging, binaryGeneration)
    } catch (copyError) {
      try {
        removeStagingDirectoryIfPresent(options.binarySlots, stagingName)
      } catch (cleanupError) {
        throw new AggregateError(
          [copyError, cleanupError],
          'Offline update binary staging failed and cleanup needs manual recovery'
        )
      }
      throw copyError
    }
  }
  syncDirectoryStrict(options.binarySlots)
}

export function stageStateGeneration(options: {
  stateGenerations: string
  generationId: string
  transactionId: string
  dataRoot: string
  statePolicy: OfflineUpdateStatePolicy
  stateManifest: OfflineUpdateStateManifest
  stateManifestSha256: string
}): void {
  const stateGeneration = join(options.stateGenerations, options.generationId)
  try {
    const existingDirectory = lstatSync(stateGeneration)
    if (!existingDirectory.isDirectory() || existingDirectory.isSymbolicLink()) {
      throw new Error('Existing offline update state slot is not a real directory')
    }
    requirePrivateDirectory(stateGeneration)
    const existingManifest = readSmallJson<OfflineUpdateStateManifest>(
      join(stateGeneration, 'state-manifest.json'),
      MAX_STATE_MANIFEST_BYTES
    )
    if (!existingManifest || hashJson(existingManifest) !== options.stateManifestSha256) {
      throw new Error('Existing offline update state slot has a different or missing manifest')
    }
    verifyStateSnapshot(stateGeneration, existingManifest)
  } catch (error) {
    if (!missing(error)) {
      throw error
    }
    const stagingName = `${options.generationId}.staging-${options.transactionId}`
    const staging = createPrivateChildDirectory(options.stateGenerations, stagingName)
    try {
      copyStateManifest(options.dataRoot, staging, options.statePolicy, options.stateManifest)
      renameDurablyStrict(staging, stateGeneration)
    } catch (copyError) {
      try {
        removeStagingDirectoryIfPresent(options.stateGenerations, stagingName)
      } catch (cleanupError) {
        throw new AggregateError(
          [copyError, cleanupError],
          'Offline update state staging failed and cleanup needs manual recovery'
        )
      }
      throw copyError
    }
  }
  syncDirectoryStrict(options.stateGenerations)
}
