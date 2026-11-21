import { chmodSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { MAX_ARTIFACT_BYTES, MAX_STATE_MANIFEST_BYTES } from './offline-update-transaction-limits'
import type {
  OfflineUpdateStateManifest,
  OfflineUpdateStatePolicy
} from './offline-update-transaction-types'
import {
  assertManifestMatchesPolicy,
  assertSnapshotManifestShape
} from './offline-update-transaction-policy'
import {
  captureOfflineUpdateStateManifest,
  inventoryDomain
} from './offline-update-transaction-inventory'
import {
  compareCanonicalText,
  hashOwnedFile,
  requirePrivateDirectory,
  requireRelativePath
} from './offline-update-transaction-paths'
import {
  createPrivateChildDirectory,
  syncDirectoryStrict,
  syncPath,
  writeJsonDurably
} from './offline-update-transaction-files'
import { hashJson } from './offline-update-transaction-journal'
import { copyProfileStateRecoveryFiles } from '../persistence/profile-state/profile-state-recovery-copy'

export function ensureTreeDirectories(root: string, relativePath: string): void {
  const parts = requireRelativePath(relativePath).split('/')
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = createPrivateChildDirectory(current, part)
  }
}

export function copyStateManifest(
  dataRoot: string,
  stateSlot: string,
  policy: OfflineUpdateStatePolicy,
  manifest: OfflineUpdateStateManifest
): void {
  assertManifestMatchesPolicy(policy, manifest)
  const copyPlan: { source: string; target: string }[] = []
  for (const domain of manifest.domains) {
    const policyDomain = policy.requiredDomains.find((item) => item.id === domain.id)
    if (!policyDomain) {
      throw new Error(`Offline update state snapshot contains an unexpected domain ${domain.id}`)
    }
    const targetDomain = createPrivateChildDirectory(stateSlot, domain.id)
    for (const file of domain.files) {
      const source = resolve(dataRoot, policyDomain.directory, file.path)
      const target = resolve(targetDomain, file.path)
      if (!target.startsWith(`${targetDomain}${sep}`)) {
        throw new Error(`Offline update snapshot path escapes domain ${domain.id}`)
      }
      ensureTreeDirectories(targetDomain, file.path)
      copyPlan.push({ source, target })
    }
  }
  copyProfileStateRecoveryFiles(copyPlan)
  for (const { source, target } of copyPlan) {
    if (hashOwnedFile(source).sha256 !== hashOwnedFile(target).sha256) {
      throw new Error('Offline update snapshot changed while its files were copied')
    }
  }
  const sourceManifest = captureOfflineUpdateStateManifest(dataRoot, policy)
  if (hashJson(sourceManifest) !== hashJson(manifest)) {
    throw new Error('Offline update source state changed while its snapshot was copied')
  }
  writeJsonDurably(join(stateSlot, 'state-manifest.json'), manifest, MAX_STATE_MANIFEST_BYTES)
  syncDirectoryStrict(stateSlot)
  verifyStateSnapshot(stateSlot, manifest)
  sealSnapshotTree(stateSlot)
}

export function sealSnapshotTree(directory: string): void {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name)
    const info = lstatSync(path)
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && !info.isFile()) ||
      (info.isFile() && info.nlink !== 1)
    ) {
      throw new Error('Offline update snapshot cannot seal a linked or non-regular entry')
    }
    if (info.isDirectory()) {
      sealSnapshotTree(path)
      chmodSync(path, 0o500)
      syncPath(path, true)
    } else {
      chmodSync(path, 0o400)
      syncPath(path)
    }
  }
  chmodSync(directory, 0o500)
  syncPath(directory, true)
}

export function copyArtifact(
  artifactPath: string,
  expectedSha256: string,
  targetPath: string
): void {
  const input = hashOwnedFile(artifactPath, MAX_ARTIFACT_BYTES)
  if (input.sha256 !== expectedSha256) {
    throw new Error('Offline update AppImage bytes do not match the expected SHA-256')
  }
  copyProfileStateRecoveryFiles([{ source: artifactPath, target: targetPath }])
  const output = hashOwnedFile(targetPath, MAX_ARTIFACT_BYTES)
  if (output.size !== input.size || output.sha256 !== input.sha256) {
    throw new Error('Offline update AppImage slot does not match its sealed input bytes')
  }
}

export function verifyStateSnapshot(statePath: string, manifest: OfflineUpdateStateManifest): void {
  requirePrivateDirectory(statePath)
  assertSnapshotManifestShape(manifest)
  const expectedNames = [...manifest.domains.map(({ id }) => id), 'state-manifest.json'].sort()
  if (JSON.stringify(readdirSync(statePath).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error('Offline update state snapshot contains missing or unexpected entries')
  }
  for (const domain of manifest.domains) {
    const actualFiles = inventoryDomain(statePath, domain.id)
    const expectedFiles = [...domain.files].sort((left, right) =>
      compareCanonicalText(left.path, right.path)
    )
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
        `Offline update state snapshot contents do not match the manifest for ${domain.id}`
      )
    }
  }
}
