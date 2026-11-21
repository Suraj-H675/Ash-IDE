import { lstatSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  MAX_DOMAIN_BYTES,
  MAX_DOMAIN_FILES,
  MAX_STATE_MANIFEST_BYTES,
  MAX_TOTAL_STATE_BYTES,
  MAX_TOTAL_STATE_FILES
} from './offline-update-transaction-limits'
import type {
  OfflineUpdateStateDomainManifest,
  OfflineUpdateStateManifest,
  OfflineUpdateStatePolicy
} from './offline-update-transaction-types'
import {
  compareCanonicalText,
  hashOwnedFile,
  requireOwnedDirectoryTree,
  requirePrivateDirectory,
  requireRelativePath
} from './offline-update-transaction-paths'
import { assertManifestBudget, assertPolicy } from './offline-update-transaction-policy'

export function inventoryDomain(
  root: string,
  relativeDirectory: string
): OfflineUpdateStateDomainManifest['files'] {
  const directory = requireOwnedDirectoryTree(root, relativeDirectory)
  if (!directory.startsWith(`${root}${sep}`)) {
    throw new Error('Offline update state domain escapes the data root')
  }
  const entries: OfflineUpdateStateDomainManifest['files'] = []
  let totalBytes = 0
  const visit = (current: string): void => {
    const beforeDirectory = lstatSync(current)
    if (
      !beforeDirectory.isDirectory() ||
      beforeDirectory.isSymbolicLink() ||
      beforeDirectory.uid !== process.getuid?.()
    ) {
      throw new Error(
        `Offline update state directory changed during inventory: ${relativeDirectory}`
      )
    }
    const children = readdirSync(current).sort()
    if (children.length === 0) {
      throw new Error(
        `Offline update state domain contains an empty directory: ${relativeDirectory}`
      )
    }
    for (const name of children) {
      const path = join(current, name)
      const info = lstatSync(path)
      if (info.isSymbolicLink()) {
        throw new Error(`Offline update state domain contains a linked path: ${relativeDirectory}`)
      }
      if (info.isDirectory()) {
        if (info.uid !== process.getuid?.()) {
          throw new Error(`Offline update state directory is foreign: ${relativeDirectory}`)
        }
        visit(path)
        continue
      }
      if (!info.isFile() || info.nlink !== 1) {
        throw new Error(
          `Offline update state domain contains a non-regular or hard-linked file: ${relativeDirectory}`
        )
      }
      const filePath = relative(directory, path).split(sep).join('/')
      requireRelativePath(filePath)
      const content = hashOwnedFile(path)
      totalBytes += content.size
      if (
        entries.length >= MAX_DOMAIN_FILES ||
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > MAX_DOMAIN_BYTES
      ) {
        throw new Error(
          `Offline update state domain exceeds its file or byte limit: ${relativeDirectory}`
        )
      }
      entries.push({ path: filePath, ...content })
    }
    const afterDirectory = lstatSync(current)
    if (
      afterDirectory.dev !== beforeDirectory.dev ||
      afterDirectory.ino !== beforeDirectory.ino ||
      afterDirectory.mtimeMs !== beforeDirectory.mtimeMs ||
      afterDirectory.ctimeMs !== beforeDirectory.ctimeMs
    ) {
      throw new Error(
        `Offline update state directory changed during inventory: ${relativeDirectory}`
      )
    }
  }
  visit(directory)
  if (entries.length === 0) {
    throw new Error(`Required offline update state domain is empty: ${relativeDirectory}`)
  }
  return entries.sort((left, right) => compareCanonicalText(left.path, right.path))
}

export function captureOfflineUpdateStateManifest(
  dataRootPath: string,
  policy: OfflineUpdateStatePolicy
): OfflineUpdateStateManifest {
  assertPolicy(policy)
  const dataRoot = requirePrivateDirectory(dataRootPath)
  let fileCount = 0
  let totalBytes = 0
  const domains = policy.requiredDomains
    .map((domain) => {
      const directory = requireOwnedDirectoryTree(dataRoot, domain.directory)
      const inspectedSchemaVersion = domain.inspectSchema(directory)
      if (inspectedSchemaVersion !== domain.schemaVersion) {
        throw new Error(
          `Required offline update state domain ${domain.id} has an incompatible schema`
        )
      }
      const files = inventoryDomain(dataRoot, domain.directory)
      fileCount += files.length
      totalBytes += files.reduce((sum, file) => sum + file.size, 0)
      if (
        fileCount > MAX_TOTAL_STATE_FILES ||
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > MAX_TOTAL_STATE_BYTES
      ) {
        throw new Error('Offline update state manifest exceeds its total file or byte limit')
      }
      return {
        id: domain.id,
        schemaVersion: inspectedSchemaVersion,
        files
      }
    })
    .sort((left, right) => compareCanonicalText(left.id, right.id))
  const manifest: OfflineUpdateStateManifest = {
    schema: 1,
    coverage: 'explicit-policy-subset',
    sourceProductVersion: policy.sourceProductVersion,
    targetProductVersion: policy.targetProductVersion,
    requiredDomainIds: [...policy.requiredDomainIds].sort(),
    excludedDomains: [...policy.excludedDomains].sort(),
    domains
  }
  assertManifestBudget(manifest.domains)
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_STATE_MANIFEST_BYTES) {
    throw new Error('Offline update state manifest exceeds its bounded storage limit')
  }
  return manifest
}
