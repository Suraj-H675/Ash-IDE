import {
  MAX_DOMAINS,
  MAX_FILE_BYTES,
  MAX_STATE_MANIFEST_BYTES,
  MAX_TOTAL_STATE_BYTES,
  MAX_TOTAL_STATE_FILES,
  REQUIRED_EXCLUSIONS
} from './offline-update-transaction-limits'
import type {
  OfflineUpdateStateDomainManifest,
  OfflineUpdateStateManifest,
  OfflineUpdateStatePolicy
} from './offline-update-transaction-types'
import {
  compareCanonicalText,
  requireRelativePath,
  requireStableVersion
} from './offline-update-transaction-paths'

export function sameRequiredDomainIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

export function assertPolicy(policy: OfflineUpdateStatePolicy): void {
  requireStableVersion(policy.sourceProductVersion)
  requireStableVersion(policy.targetProductVersion)
  if (
    policy.schema !== 1 ||
    !Array.isArray(policy.requiredDomains) ||
    policy.requiredDomains.length === 0 ||
    policy.requiredDomains.length > MAX_DOMAINS ||
    !Array.isArray(policy.requiredDomainIds) ||
    !Array.isArray(policy.excludedDomains)
  ) {
    throw new Error('Offline update state policy is incomplete')
  }
  const ids = policy.requiredDomains.map(({ id }) => id)
  if (!sameRequiredDomainIds(policy.requiredDomainIds, ids)) {
    throw new Error('Offline update state policy is missing a declared required domain')
  }
  const directories = policy.requiredDomains.map(({ directory }) => requireRelativePath(directory))
  if (
    new Set(ids).size !== ids.length ||
    new Set(directories).size !== directories.length ||
    ids.some((id) => !/^[a-z][a-z0-9-]{0,63}$/u.test(id)) ||
    policy.requiredDomains.some(
      (domain) =>
        !Number.isSafeInteger(domain.schemaVersion) ||
        domain.schemaVersion < 1 ||
        typeof domain.inspectSchema !== 'function' ||
        REQUIRED_EXCLUSIONS.includes(domain.id as (typeof REQUIRED_EXCLUSIONS)[number])
    ) ||
    directories.some(
      (directory) =>
        !directory.startsWith('fixture/') ||
        directory === '.ash-offline-update' ||
        directory.startsWith('.ash-offline-update/') ||
        directories.some(
          (other) =>
            other !== directory &&
            (other.startsWith(`${directory}/`) || directory.startsWith(`${other}/`))
        )
    )
  ) {
    throw new Error('Offline update state policy has an invalid or excluded required domain')
  }
  const excluded = [...policy.excludedDomains].sort()
  if (
    JSON.stringify(excluded) !== JSON.stringify([...REQUIRED_EXCLUSIONS].sort()) ||
    new Set(excluded).size !== excluded.length
  ) {
    throw new Error(
      'Offline update state policy must preserve provider, project, cache, Orca, and runtime state'
    )
  }
}

export function assertManifestBudget(domains: readonly OfflineUpdateStateDomainManifest[]): void {
  if (domains.length === 0 || domains.length > MAX_DOMAINS) {
    throw new Error('Offline update state manifest exceeds its domain limit')
  }
  let fileCount = 0
  let totalBytes = 0
  for (const domain of domains) {
    fileCount += domain.files.length
    totalBytes += domain.files.reduce((sum, file) => sum + file.size, 0)
    if (
      fileCount > MAX_TOTAL_STATE_FILES ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > MAX_TOTAL_STATE_BYTES
    ) {
      throw new Error('Offline update state manifest exceeds its total file or byte limit')
    }
  }
}

export function assertManifestMatchesPolicy(
  policy: OfflineUpdateStatePolicy,
  manifest: OfflineUpdateStateManifest
): void {
  assertPolicy(policy)
  const required = [...policy.requiredDomains].sort((left, right) =>
    compareCanonicalText(left.id, right.id)
  )
  if (
    manifest.schema !== 1 ||
    manifest.coverage !== 'explicit-policy-subset' ||
    manifest.sourceProductVersion !== policy.sourceProductVersion ||
    manifest.targetProductVersion !== policy.targetProductVersion ||
    JSON.stringify(manifest.requiredDomainIds) !==
      JSON.stringify([...policy.requiredDomainIds].sort()) ||
    JSON.stringify(manifest.excludedDomains) !==
      JSON.stringify([...policy.excludedDomains].sort()) ||
    manifest.domains.length !== required.length
  ) {
    throw new Error(
      'Offline update state snapshot does not match the required compatible-state policy'
    )
  }
  assertManifestBudget(manifest.domains)
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_STATE_MANIFEST_BYTES) {
    throw new Error('Offline update state manifest exceeds its bounded storage limit')
  }
  for (let index = 0; index < required.length; index += 1) {
    const expected = required[index]
    const actual = manifest.domains[index]
    if (
      !actual ||
      actual.id !== expected.id ||
      actual.schemaVersion !== expected.schemaVersion ||
      actual.files.length === 0
    ) {
      throw new Error(`Offline update state snapshot is missing required domain ${expected.id}`)
    }
    const names = new Set<string>()
    for (const file of actual.files) {
      requireRelativePath(file.path)
      if (
        names.has(file.path) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > MAX_FILE_BYTES ||
        !/^[a-f0-9]{64}$/u.test(file.sha256)
      ) {
        throw new Error(`Offline update state snapshot has an invalid file entry in ${actual.id}`)
      }
      names.add(file.path)
    }
  }
}

export function validateGenerationId(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Offline update generation id must be a SHA-256 digest')
  }
}

export function assertSnapshotManifestShape(manifest: OfflineUpdateStateManifest): void {
  if (
    !Array.isArray(manifest.excludedDomains) ||
    !Array.isArray(manifest.requiredDomainIds) ||
    !Array.isArray(manifest.domains)
  ) {
    throw new Error('Offline update state snapshot manifest is malformed or incomplete')
  }
  requireStableVersion(manifest.sourceProductVersion)
  requireStableVersion(manifest.targetProductVersion)
  if (
    manifest.schema !== 1 ||
    manifest.coverage !== 'explicit-policy-subset' ||
    JSON.stringify(manifest.excludedDomains) !== JSON.stringify([...REQUIRED_EXCLUSIONS].sort()) ||
    manifest.requiredDomainIds.length === 0 ||
    JSON.stringify(manifest.requiredDomainIds) !==
      JSON.stringify([...manifest.requiredDomainIds].sort()) ||
    manifest.domains.length === 0
  ) {
    throw new Error('Offline update state snapshot manifest is malformed or incomplete')
  }
  const ids = new Set<string>()
  for (const domain of manifest.domains) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/u.test(domain.id) ||
      ids.has(domain.id) ||
      !Number.isSafeInteger(domain.schemaVersion) ||
      domain.schemaVersion < 1 ||
      !Array.isArray(domain.files) ||
      domain.files.length === 0
    ) {
      throw new Error('Offline update state snapshot has an invalid domain manifest')
    }
    ids.add(domain.id)
    const names = new Set<string>()
    for (const file of domain.files) {
      requireRelativePath(file.path)
      if (
        names.has(file.path) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > MAX_FILE_BYTES ||
        !/^[a-f0-9]{64}$/u.test(file.sha256)
      ) {
        throw new Error(`Offline update state snapshot has an invalid file in ${domain.id}`)
      }
      names.add(file.path)
    }
  }
  if (
    JSON.stringify([...manifest.domains].map(({ id }) => id).sort()) !==
    JSON.stringify([...ids].sort())
  ) {
    throw new Error('Offline update state snapshot domains are not canonical')
  }
  if (JSON.stringify(manifest.requiredDomainIds) !== JSON.stringify([...ids].sort())) {
    throw new Error('Offline update state snapshot is missing a required state domain')
  }
  assertManifestBudget(manifest.domains)
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_STATE_MANIFEST_BYTES) {
    throw new Error('Offline update state manifest exceeds its bounded storage limit')
  }
}
