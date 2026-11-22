import type {
  CandidatePackageIdentityEvidence,
  UpdatePreflightBlocker,
  UpdatePreflightCount,
  UpdatePreflightReport,
  UpdateRuntimeCensus
} from '../../shared/update-preflight-types'

export const NO_STAGED_UPDATE_CANDIDATE: CandidatePackageIdentityEvidence = {
  state: 'unavailable',
  source: 'no-candidate',
  reason: 'no-staged-candidate'
}

function isActive(evidence: UpdatePreflightCount): boolean {
  return evidence.state === 'known' ? evidence.count > 0 : evidence.lowerBound > 0
}

export function assessUpdatePreflight(
  candidateIdentity: CandidatePackageIdentityEvidence,
  runtime: UpdateRuntimeCensus
): UpdatePreflightReport {
  const blockers = new Set<UpdatePreflightBlocker>([
    'release-signing-unapproved',
    'exclusive-maintenance-fence-unavailable',
    'complete-state-rollback-unavailable'
  ])
  blockers.add(
    candidateIdentity.state === 'unavailable'
      ? 'candidate-not-provided'
      : 'candidate-identity-unverified'
  )
  if (runtime.hostOwnership.state === 'unknown') {
    blockers.add('host-ownership-unverified')
  }
  if (runtime.daemonGenerations.state === 'unknown') {
    blockers.add('daemon-generation-inventory-unknown')
  }
  if (runtime.windows.state === 'unknown') {
    blockers.add('window-inventory-unknown')
  }
  if (isActive(runtime.windows)) {
    blockers.add('gui-window-active')
  }
  if (runtime.ptys.state === 'unknown') {
    blockers.add('pty-inventory-unknown')
  }
  if (isActive(runtime.ptys)) {
    blockers.add('pty-active')
  }
  if (runtime.ptyOwnedAgentSessions.state === 'unknown') {
    blockers.add('agent-owner-inventory-unknown')
  }
  if (isActive(runtime.ptyOwnedAgentSessions)) {
    blockers.add('agent-session-active')
  }
  if (runtime.providerAgentSessions.state === 'unknown') {
    blockers.add('provider-agent-inventory-unknown')
  }
  if (runtime.pendingDiskWrites.state === 'unknown') {
    blockers.add('pending-disk-writes-unknown')
  }
  const busy = [runtime.windows, runtime.ptys, runtime.ptyOwnedAgentSessions].some(isActive)
  return {
    decision: busy ? 'busy' : 'defer',
    candidateIdentity,
    runtime,
    blockers: [...blockers],
    activationAvailable: false
  }
}
