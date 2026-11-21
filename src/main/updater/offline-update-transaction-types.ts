export type OfflineUpdateStateDomainPolicy = {
  id: string
  directory: string
  schemaVersion: number
  /** Test-only read-only schema inspector. Its result must match schemaVersion. */
  inspectSchema(directory: string): number
}

export type OfflineUpdateStatePolicy = {
  schema: 1
  sourceProductVersion: string
  targetProductVersion: string
  requiredDomainIds: readonly string[]
  requiredDomains: readonly OfflineUpdateStateDomainPolicy[]
  excludedDomains: readonly string[]
}

export type OfflineUpdateStateDomainManifest = {
  id: string
  schemaVersion: number
  files: { path: string; size: number; sha256: string }[]
}

export type OfflineUpdateStateManifest = {
  schema: 1
  coverage: 'explicit-policy-subset'
  sourceProductVersion: string
  targetProductVersion: string
  requiredDomainIds: string[]
  excludedDomains: string[]
  domains: OfflineUpdateStateDomainManifest[]
}

export type OfflineUpdateFence = {
  readonly installRoot: string
  readonly userDataPath: string
  readonly coverage: 'ash-process-and-profile-state-only'
  assertActive(): void
  release(): void
}

export type OfflineUpdateGeneration = {
  generationId: string
  artifactSha256: string
  stateManifestSha256: string
  artifactPath: string
  statePath: string
}

export type OfflineUpdateBoundary =
  | 'journal-preparing'
  | 'binary-slot-durable'
  | 'state-slot-durable'
  | 'journal-prepared'
  | 'pointer-durable'
  | 'journal-committed'
  | 'rollback-journal-durable'
  | 'rollback-pointer-durable'
  | 'rollback-journal-committed'

export type TransactionJournal = {
  schema: 1
  transactionId: string
  previousGenerationId: string | null
  candidateGenerationId: string
  artifactSha256: string
  stateManifestSha256: string
  phase: 'preparing' | 'prepared' | 'committed' | 'rolling-back' | 'rolled-back'
}

export type ActiveGenerationPointer = {
  schema: 1
  generationId: string
  artifactSha256: string
  stateManifestSha256: string
}

export type StoreOfflineUpdateGenerationOptions = {
  installRoot: string
  dataRoot: string
  artifactPath: string
  artifactSha256: string
  statePolicy: OfflineUpdateStatePolicy
  fence: OfflineUpdateFence
  onBoundary?: (boundary: OfflineUpdateBoundary) => void
}

export type OfflineUpdateRecoveryResult =
  | { state: 'no-transaction'; activeGeneration: OfflineUpdateGeneration | null }
  | { state: 'previous-generation-active'; activeGeneration: OfflineUpdateGeneration | null }
  | { state: 'candidate-generation-active'; activeGeneration: OfflineUpdateGeneration }
