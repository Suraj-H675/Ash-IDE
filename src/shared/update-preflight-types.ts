export type UpdatePreflightUnknownReason =
  | 'daemon-unavailable'
  | 'daemon-disconnected'
  | 'inventory-partial'
  | 'inventory-invalid'
  | 'daemon-identity-changed'
  | 'provider-changed'
  | 'generation-limit-exceeded'
  | 'fallback-inventory-unavailable'
  | 'window-inventory-unavailable'
  | 'provider-agent-inventory-unavailable'
  | 'agent-owner-inventory-incomplete'
  | 'pending-write-census-unavailable'
  | 'exclusive-host-ownership-unavailable'

export type UpdatePreflightCount =
  | { state: 'known'; count: number }
  | { state: 'unknown'; reason: UpdatePreflightUnknownReason; lowerBound: number }

export type CandidatePackageIdentityEvidence =
  | {
      state: 'unavailable'
      source: 'no-candidate'
      reason: 'no-staged-candidate'
    }
  | {
      state: 'unverified'
      source: 'signed-manifest-claim' | 'signed-packaging-input-claim'
      appIdClaim: string
      productNameClaim: string | null
      versionClaim: string
      architectureClaim: 'x64' | 'arm64'
      artifactSha256: string
      artifactSha256Verified: true
      reason: 'embedded-appimage-payload-not-inspected'
      packagingInputClaim?: {
        evidenceKind: 'packaging-input-snapshot'
        sourceCommit: string | null
        capturedAppAsarSha256: string
        capturedCompiledCliPackageJsonSha256: string
      }
    }

export type UpdateRuntimeCensus = {
  observedAtMs: number
  hostOwnership: {
    state: 'unknown'
    reason: 'exclusive-host-ownership-unavailable'
  }
  daemonGenerations: UpdatePreflightCount
  windows: UpdatePreflightCount
  ptys: UpdatePreflightCount
  ptyOwnedAgentSessions: UpdatePreflightCount
  providerAgentSessions: {
    state: 'unknown'
    reason: 'provider-agent-inventory-unavailable'
    /** Positive native Chat children observed locally or in the authenticated runtime; never a complete provider census. */
    lowerBound?: number
  }
  pendingDiskWrites: {
    state: 'unknown'
    reason: 'pending-write-census-unavailable'
    /** Positive local Store evidence, not a complete host-wide write count. */
    lowerBound: number
  }
}

export type UpdatePreflightBlocker =
  | 'candidate-not-provided'
  | 'candidate-identity-unverified'
  | 'release-signing-unapproved'
  | 'exclusive-maintenance-fence-unavailable'
  | 'complete-state-rollback-unavailable'
  | 'host-ownership-unverified'
  | 'daemon-generation-inventory-unknown'
  | 'window-inventory-unknown'
  | 'gui-window-active'
  | 'pty-inventory-unknown'
  | 'pty-active'
  | 'agent-owner-inventory-unknown'
  | 'agent-session-active'
  | 'provider-agent-inventory-unknown'
  | 'provider-agent-session-observed'
  | 'pending-disk-writes-unknown'
  | 'pending-disk-writes-observed'

export type UpdatePreflightReport = {
  decision: 'busy' | 'defer'
  candidateIdentity: CandidatePackageIdentityEvidence
  runtime: UpdateRuntimeCensus
  blockers: UpdatePreflightBlocker[]
  activationAvailable: false
}
