import { createHash, randomUUID } from 'node:crypto'
import {
  isVerifiedClaudeManagedAccountProfile,
  type ClaudeManagedAccountIdentity,
  type VerifiedClaudeManagedAccountProfile
} from '../../claude-accounts/claude-managed-account-identity'
import { parsePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import { isPtyIncarnationId } from '../../../shared/terminal/pty/lifecycle/pty-incarnation'

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const SHA256 = /^[\da-f]{64}$/i
const MAX_CORRELATION_BINDINGS = 512

export type ClaudeHostLaunchCorrelationCandidate = Readonly<{
  platform: string
  runtime: string
  executionHostId: string
  connectionId: string | null
  isWsl: boolean
  accountSelection:
    | Readonly<{ kind: 'managed'; accountId: string }>
    | Readonly<{ kind: 'system' | 'unknown' }>
  accountVerification: VerifiedClaudeManagedAccountProfile | null
  paneKey: string
  tabId: string
  worktreeId: string
  pty: Readonly<{ id: string; incarnationId: string | null; running: boolean }>
  session:
    | Readonly<{ kind: 'fresh' }>
    | Readonly<{ kind: 'resume'; expectedProviderSessionId: string }>
}>

export type ClaudeHostLaunchCorrelationSnapshot = Readonly<{
  platform: 'darwin' | 'linux'
  runtime: 'host'
  executionHostId: 'local'
  connectionId: null
  accountId: string
  accountIdentity: Readonly<ClaudeManagedAccountIdentity>
  ownershipMarker: Readonly<{ device: string; inode: string }>
  paneKey: string
  tabId: string
  worktreeId: string
  ptyId: string
  incarnationId: string
  session: Readonly<{ kind: 'fresh' } | { kind: 'resume'; expectedProviderSessionId: string }>
}>

export type ClaudeHostLaunchCorrelationRejection =
  | 'unsupported-host'
  | 'non-local-runtime'
  | 'account-not-managed'
  | 'account-identity-mismatch'
  | 'invalid-pane-identity'
  | 'missing-pty-incarnation'
  | 'pty-not-running'
  | 'invalid-resume-session'
  | 'invalid-launch-token'
  | 'launch-token-reused'
  | 'binding-capacity-exceeded'
  | 'unexpected-session-start-source'
  | 'pane-already-bound'
  | 'binding-unknown'
  | 'binding-closed'
  | 'binding-retired'
  | 'missing-launch-token'
  | 'stale-or-wrong-launch-token'
  | 'wrong-provider-event'
  | 'root-session-not-established'
  | 'child-session'
  | 'forked-session'
  | 'remote-session'
  | 'wrong-pane-or-worktree'
  | 'pty-incarnation-mismatch'
  | 'invalid-session-id'
  | 'resume-session-mismatch'
  | 'session-replay'
  | 'session-already-bound'

export type ClaudeHostLaunchCorrelationResult =
  | Readonly<{ kind: 'consistency-only'; status: 'accepted'; sessionId: string }>
  | Readonly<{
      kind: 'consistency-only'
      status: 'rejected'
      reason: ClaudeHostLaunchCorrelationRejection
    }>

export type ClaudeSessionStartObservation = Readonly<{
  provider: unknown
  eventName: unknown
  /** Claude SessionStart payload source; clear/compact must never create a new launch binding. */
  sessionStartSource: unknown
  sessionId: unknown
  paneKey: string
  worktreeId: string
  executionHostId: string
  connectionId: string | null
  rootAdmission: 'root' | 'child' | 'unknown'
  agentId?: unknown
  parentSessionId?: unknown
  forkedFromSessionId?: unknown
  isFork?: unknown
  isRemote?: unknown
  isWsl?: unknown
  isReplay?: unknown
}>

export type ClaudeHostPtySnapshot = Readonly<{
  ptyId: string
  incarnationId: string | null
  paneKey: string
  worktreeId: string
  executionHostId: string
  connectionId: string | null
  isWsl: boolean
  running: boolean
}>

type BindingState = {
  readonly snapshot: ClaudeHostLaunchCorrelationSnapshot
  readonly launchTokenHash: string
  status: 'running' | 'closed' | 'retired'
  acceptedSessionId?: string
}

export type ClaudeHostLaunchCorrelationIssue =
  | Readonly<{
      kind: 'consistency-only'
      status: 'issued'
      launchToken: string
      launchTokenHash: string
      snapshot: ClaudeHostLaunchCorrelationSnapshot
    }>
  | Readonly<{
      kind: 'consistency-only'
      status: 'rejected'
      reason: ClaudeHostLaunchCorrelationRejection
    }>

function reject(reason: ClaudeHostLaunchCorrelationRejection): ClaudeHostLaunchCorrelationResult {
  return Object.freeze({ kind: 'consistency-only', status: 'rejected', reason })
}

function isLocalPosix(platform: string): platform is 'darwin' | 'linux' {
  return platform === 'darwin' || platform === 'linux'
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function accountIdentityIsConsistent(
  verification: VerifiedClaudeManagedAccountProfile,
  selectedAccountId: string,
  platform: string
): boolean {
  if (!isVerifiedClaudeManagedAccountProfile(verification)) {
    return false
  }
  const { identity, ownershipMarker } = verification
  return (
    identity.version === 1 &&
    identity.accountId === selectedAccountId &&
    identity.runtime === 'host' &&
    identity.hostPlatform === platform &&
    typeof identity.home === 'string' &&
    identity.home.length > 0 &&
    typeof identity.configHomeIdentity === 'string' &&
    identity.configHomeIdentity.length > 0 &&
    /^\d+$/.test(identity.configHomeDevice) &&
    /^\d+$/.test(identity.configHomeInode) &&
    SHA256.test(identity.ownershipMarkerSha256) &&
    /^\d+$/.test(ownershipMarker.device) &&
    /^\d+$/.test(ownershipMarker.inode)
  )
}

function snapshotCandidate(
  candidate: ClaudeHostLaunchCorrelationCandidate
):
  | { snapshot: ClaudeHostLaunchCorrelationSnapshot }
  | { reason: ClaudeHostLaunchCorrelationRejection } {
  if (!isLocalPosix(candidate.platform) || candidate.platform !== process.platform) {
    return { reason: 'unsupported-host' }
  }
  if (
    candidate.runtime !== 'host' ||
    candidate.executionHostId !== 'local' ||
    candidate.connectionId !== null ||
    candidate.isWsl
  ) {
    return { reason: 'non-local-runtime' }
  }
  if (candidate.accountSelection.kind !== 'managed') {
    return { reason: 'account-not-managed' }
  }
  const accountId = candidate.accountSelection.accountId.trim()
  if (
    !accountId ||
    accountId === 'system' ||
    accountId === 'unknown' ||
    !candidate.accountVerification ||
    !accountIdentityIsConsistent(candidate.accountVerification, accountId, candidate.platform)
  ) {
    return { reason: 'account-identity-mismatch' }
  }

  const pane = parsePaneKey(candidate.paneKey)
  if (
    !pane ||
    pane.tabId !== candidate.tabId ||
    !candidate.worktreeId.trim() ||
    candidate.pty.id.trim().length === 0 ||
    candidate.pty.id === candidate.tabId
  ) {
    return { reason: 'invalid-pane-identity' }
  }
  if (!isPtyIncarnationId(candidate.pty.incarnationId) || !candidate.pty.incarnationId.trim()) {
    return { reason: 'missing-pty-incarnation' }
  }
  if (candidate.pty.incarnationId === candidate.tabId) {
    return { reason: 'invalid-pane-identity' }
  }
  if (!candidate.pty.running) {
    return { reason: 'pty-not-running' }
  }
  if (
    candidate.session.kind === 'resume' &&
    !UUID_V4.test(candidate.session.expectedProviderSessionId)
  ) {
    return { reason: 'invalid-resume-session' }
  }

  const accountIdentity = Object.freeze({ ...candidate.accountVerification.identity })
  const ownershipMarker = Object.freeze({ ...candidate.accountVerification.ownershipMarker })
  const session = Object.freeze({
    ...candidate.session
  }) as ClaudeHostLaunchCorrelationSnapshot['session']
  return {
    snapshot: Object.freeze({
      platform: candidate.platform,
      runtime: 'host',
      executionHostId: 'local',
      connectionId: null,
      accountId,
      accountIdentity,
      ownershipMarker,
      paneKey: candidate.paneKey,
      tabId: candidate.tabId,
      worktreeId: candidate.worktreeId,
      ptyId: candidate.pty.id,
      incarnationId: candidate.pty.incarnationId,
      session
    })
  }
}

/**
 * Dormant host-side correlation contract. Every outcome is consistency-only:
 * this class has no production spawn, hook, renderer, RPC, or persistence caller.
 * Its inputs do not prove that a launch command and the supplied PTY are linked.
 */
export class ClaudeHostLaunchCorrelationConsistency {
  private readonly bindingByPane = new Map<string, BindingState>()
  private readonly bindingByTokenHash = new Map<string, BindingState>()

  issue(candidate: ClaudeHostLaunchCorrelationCandidate): ClaudeHostLaunchCorrelationIssue {
    const normalized = snapshotCandidate(candidate)
    if ('reason' in normalized) {
      return Object.freeze({ kind: 'consistency-only', status: 'rejected', ...normalized })
    }
    const { snapshot } = normalized
    const previousPaneBinding = this.bindingByPane.get(snapshot.paneKey)
    if (previousPaneBinding?.status === 'running') {
      return Object.freeze({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'pane-already-bound'
      })
    }

    // A retired/closed binding can never return to running. Remove both indexes
    // before reusing its pane key, and reap old tombstones to bound host memory.
    if (previousPaneBinding) {
      this.bindingByTokenHash.delete(previousPaneBinding.launchTokenHash)
      this.bindingByPane.delete(snapshot.paneKey)
    }
    if (this.bindingByPane.size >= MAX_CORRELATION_BINDINGS) {
      for (const [paneKey, entry] of this.bindingByPane) {
        if (entry.status === 'running') {
          continue
        }
        this.bindingByPane.delete(paneKey)
        this.bindingByTokenHash.delete(entry.launchTokenHash)
        if (this.bindingByPane.size < MAX_CORRELATION_BINDINGS) {
          break
        }
      }
      if (this.bindingByPane.size >= MAX_CORRELATION_BINDINGS) {
        return Object.freeze({
          kind: 'consistency-only',
          status: 'rejected',
          reason: 'binding-capacity-exceeded'
        })
      }
    }

    const launchToken = randomUUID()
    if (!UUID_V4.test(launchToken)) {
      return Object.freeze({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'invalid-launch-token'
      })
    }
    const launchTokenHash = createHash('sha256').update(launchToken).digest('hex')
    if (this.bindingByTokenHash.has(launchTokenHash)) {
      return Object.freeze({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'launch-token-reused'
      })
    }
    const state: BindingState = { snapshot, launchTokenHash, status: 'running' }
    this.bindingByPane.set(snapshot.paneKey, state)
    this.bindingByTokenHash.set(launchTokenHash, state)
    return Object.freeze({
      kind: 'consistency-only',
      status: 'issued',
      launchToken,
      launchTokenHash,
      snapshot
    })
  }

  observeSessionStart(
    launchToken: unknown,
    event: ClaudeSessionStartObservation,
    currentPty: ClaudeHostPtySnapshot
  ): ClaudeHostLaunchCorrelationResult {
    const state = this.bindingByPane.get(event.paneKey)
    if (!state) {
      return reject('binding-unknown')
    }
    if (state.status === 'closed') {
      return reject('binding-closed')
    }
    if (state.status === 'retired') {
      return reject('binding-retired')
    }
    if (typeof launchToken !== 'string' || !launchToken.trim()) {
      return reject('missing-launch-token')
    }
    const observedHash = createHash('sha256').update(launchToken).digest('hex')
    if (
      observedHash !== state.launchTokenHash ||
      this.bindingByTokenHash.get(observedHash) !== state
    ) {
      return reject('stale-or-wrong-launch-token')
    }
    if (event.provider !== 'claude' || event.eventName !== 'SessionStart') {
      return reject('wrong-provider-event')
    }
    const { snapshot } = state
    // Claude issues SessionStart also for /clear and compaction. Only a new
    // startup or an exact explicit resume may claim this launch's first UUID.
    if (event.sessionStartSource !== (snapshot.session.kind === 'resume' ? 'resume' : 'startup')) {
      return reject('unexpected-session-start-source')
    }
    if (event.rootAdmission !== 'root') {
      return reject('root-session-not-established')
    }
    if (hasValue(event.agentId)) {
      return reject('child-session')
    }
    if (
      hasValue(event.parentSessionId) ||
      hasValue(event.forkedFromSessionId) ||
      event.isFork !== false
    ) {
      return reject('forked-session')
    }
    if (event.isRemote !== false || event.isWsl !== false || event.connectionId !== null) {
      return reject('remote-session')
    }
    if (
      event.paneKey !== snapshot.paneKey ||
      event.worktreeId !== snapshot.worktreeId ||
      event.executionHostId !== snapshot.executionHostId ||
      event.connectionId !== snapshot.connectionId
    ) {
      return reject('wrong-pane-or-worktree')
    }
    if (
      currentPty.ptyId !== snapshot.ptyId ||
      currentPty.incarnationId !== snapshot.incarnationId ||
      currentPty.paneKey !== snapshot.paneKey ||
      currentPty.worktreeId !== snapshot.worktreeId ||
      currentPty.executionHostId !== snapshot.executionHostId ||
      currentPty.connectionId !== snapshot.connectionId ||
      currentPty.isWsl
    ) {
      return reject('pty-incarnation-mismatch')
    }
    if (!currentPty.running) {
      return reject('pty-not-running')
    }
    if (event.isReplay !== false) {
      return reject('session-replay')
    }
    if (typeof event.sessionId !== 'string' || !UUID_V4.test(event.sessionId)) {
      return reject('invalid-session-id')
    }
    if (
      snapshot.session.kind === 'resume' &&
      event.sessionId !== snapshot.session.expectedProviderSessionId
    ) {
      return reject('resume-session-mismatch')
    }
    if (state.acceptedSessionId) {
      return reject(
        state.acceptedSessionId === event.sessionId ? 'session-replay' : 'session-already-bound'
      )
    }
    state.acceptedSessionId = event.sessionId
    return Object.freeze({
      kind: 'consistency-only',
      status: 'accepted',
      sessionId: event.sessionId
    })
  }

  close(paneKey: string, ptyId: string, incarnationId: string): boolean {
    return this.endBinding(paneKey, ptyId, incarnationId, 'closed')
  }

  retire(paneKey: string, ptyId: string, incarnationId: string): boolean {
    return this.endBinding(paneKey, ptyId, incarnationId, 'retired')
  }

  private endBinding(
    paneKey: string,
    ptyId: string,
    incarnationId: string,
    status: 'closed' | 'retired'
  ): boolean {
    const state = this.bindingByPane.get(paneKey)
    if (
      !state ||
      state.status !== 'running' ||
      state.snapshot.ptyId !== ptyId ||
      state.snapshot.incarnationId !== incarnationId
    ) {
      return false
    }
    state.status = status
    return true
  }
}
