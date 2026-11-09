import { createHash } from 'node:crypto'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { isValidTerminalTabId } from '../../../../shared/workspace-layout/terminal-tab-id'
import { isPtyIncarnationId } from '../../../../shared/terminal/pty/lifecycle/pty-incarnation'
import { LocalPtyProvider } from '../../../providers/local-pty/local-pty-provider'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { RuntimePtySpawnState } from './spawn-state'
import type { PtySpawnOutcome } from '../spawn-outcome'

const MAX_COMMITTED_PTY_SPAWN_EVIDENCE = 256

/** Conservative command shape for a *candidate*, never proof of a running Claude child. */
function isDirectClaudeInvocation(command: unknown): boolean {
  if (typeof command !== 'string' || command.length === 0 || command.length > 4096) {
    return false
  }
  // Never interpret a shell pipeline, wrapper, substitution, or compound script as
  // a direct agent launch; false negatives here only omit dormant evidence.
  if (/[;&|<>`$\r\n\0]/.test(command)) {
    return false
  }
  return /^(?:claude|\/(?:[A-Za-z0-9._+@-]+\/)*claude)(?:\.cmd|\.exe)?(?:\s+[^\r\n]*)?$/i.test(
    command.trim()
  )
}

function hasPlannedDirectClaudeLaunch(state: RuntimePtySpawnState): boolean {
  return (
    state.isClaudeLaunch &&
    state.args.launchAgent === 'claude' &&
    state.spawnOptions.launchAgent === 'claude' &&
    !state.args.shellOverride &&
    !state.spawnOptions.shellOverride &&
    state.args.commandDelivery !== 'renderer' &&
    state.spawnOptions.commandDelivery !== 'renderer' &&
    isDirectClaudeInvocation(state.args.launchConfig?.agentCommand) &&
    isDirectClaudeInvocation(state.launchCommand) &&
    isDirectClaudeInvocation(state.spawnOptions.command)
  )
}

export type CommittedLocalPtySpawnEvidence = Readonly<{
  version: 1
  provider: 'local-pty'
  spawnState: 'fresh-committed'
  ptyId: string
  incarnationId: string
  worktreeId: string
  tabId: string
  leafId: string
  paneKey: string
  launchTokenHash: string
  accountEvidence: Readonly<{
    status: 'missing'
    reason: 'authenticated-managed-account-not-bound-to-effective-environment'
  }>
}>

export type CommittedLocalPtySpawnEvidenceRejection =
  | 'spawn-not-committed'
  | 'stable-pane-adopted'
  | 'provider-reattached'
  | 'not-claude-launch'
  | 'provider-mismatch'
  | 'remote-runtime'
  | 'daemon-runtime'
  | 'wsl-runtime'
  | 'provider-result-mismatch'
  | 'missing-pty-identity'
  | 'missing-launch-token'
  | 'launch-token-mismatch'
  | 'missing-host-pane-binding'
  | 'host-pane-binding-mismatch'
  | 'evidence-already-recorded'

export type CommittedLocalPtySpawnEvidenceValidation =
  | Readonly<{ accepted: true; evidence: CommittedLocalPtySpawnEvidence }>
  | Readonly<{ accepted: false; reason: CommittedLocalPtySpawnEvidenceRejection }>

function isAdoptedAgentSession(ensure: unknown): boolean {
  return (
    typeof ensure === 'object' &&
    ensure !== null &&
    'disposition' in ensure &&
    ensure.disposition === 'adopted'
  )
}

export type CommittedLocalPtySpawnEvidenceRuntime = Pick<OrcaRuntimeService, 'subscribeToPtyExit'>

type EvidenceEntry = {
  evidence: CommittedLocalPtySpawnEvidence
  unsubscribe: () => void
}

class RuntimeEvidenceStore {
  private readonly entries = new Map<string, EvidenceEntry>()

  record(
    evidence: CommittedLocalPtySpawnEvidence,
    subscribeToExit: (listener: () => void) => () => void
  ): boolean {
    const key = evidenceKey(evidence.ptyId, evidence.incarnationId)
    if (this.entries.has(key)) {
      return false
    }
    const entry: EvidenceEntry = { evidence, unsubscribe: () => {} }
    this.entries.set(key, entry)
    let unsubscribe: () => void
    try {
      unsubscribe = subscribeToExit(() => this.remove(evidence.ptyId, evidence.incarnationId))
    } catch {
      // No exit observer means no defensible live evidence. Roll back before
      // returning; otherwise a failing registration bypasses the capacity cap.
      this.removeKey(key)
      return false
    }
    if (this.entries.get(key) === entry) {
      entry.unsubscribe = unsubscribe
    } else {
      unsubscribe()
    }
    while (this.entries.size > MAX_COMMITTED_PTY_SPAWN_EVIDENCE) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      this.removeKey(oldestKey)
    }
    return this.entries.get(key) === entry
  }

  read(ptyId: string, incarnationId: string): CommittedLocalPtySpawnEvidence | null {
    return this.entries.get(evidenceKey(ptyId, incarnationId))?.evidence ?? null
  }

  remove(ptyId: string, incarnationId: string): void {
    this.removeKey(evidenceKey(ptyId, incarnationId))
  }

  private removeKey(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) {
      return
    }
    this.entries.delete(key)
    entry.unsubscribe()
  }
}

const evidenceByRuntime = new WeakMap<object, RuntimeEvidenceStore>()

function evidenceStoreFor(runtime: object): RuntimeEvidenceStore {
  let store = evidenceByRuntime.get(runtime)
  if (!store) {
    store = new RuntimeEvidenceStore()
    evidenceByRuntime.set(runtime, store)
  }
  return store
}

function evidenceKey(ptyId: string, incarnationId: string): string {
  return `${ptyId}\0${incarnationId}`
}

function reject(
  reason: CommittedLocalPtySpawnEvidenceRejection
): CommittedLocalPtySpawnEvidenceValidation {
  return Object.freeze({ accepted: false, reason })
}

function readCommittedPaneIdentity(
  state: RuntimePtySpawnState
):
  | Readonly<{ worktreeId: string; tabId: string; leafId: string; paneKey: string }>
  | CommittedLocalPtySpawnEvidenceRejection {
  const binding = state.hostSessionBinding
  if (!binding) {
    return 'missing-host-pane-binding'
  }
  const { worktreeId, tabId, leafId, store } = binding
  if (
    worktreeId.trim().length === 0 ||
    !isValidTerminalTabId(tabId) ||
    tabId.length > 512 ||
    !isTerminalLeafId(leafId)
  ) {
    return 'missing-host-pane-binding'
  }
  const paneKey = makePaneKey(tabId, leafId)
  try {
    const session = store.getWorkspaceSession()
    const tabExists = session.tabsByWorktree?.[worktreeId]?.some(
      (tab) => tab.id === tabId && tab.worktreeId === worktreeId
    )
    const persistedPtyId = session.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId?.[leafId]
    const persistedIncarnationId = session.terminalPtyIncarnationsByPaneKey?.[paneKey]
    if (
      !tabExists ||
      persistedPtyId !== state.result.id ||
      persistedIncarnationId !== state.result.incarnationId
    ) {
      return 'host-pane-binding-mismatch'
    }
  } catch {
    return 'host-pane-binding-mismatch'
  }
  return Object.freeze({ worktreeId, tabId, leafId, paneKey })
}

export function validateCommittedLocalPtySpawnEvidence(
  state: RuntimePtySpawnState,
  outcome: PtySpawnOutcome
): CommittedLocalPtySpawnEvidenceValidation {
  if (outcome.kind !== 'committed') {
    return reject('spawn-not-committed')
  }
  if (
    state.preAdoptedStablePane ||
    state.args.adoptedStablePane ||
    state.stablePaneOwner ||
    isAdoptedAgentSession(state.result.agentSessionEnsure)
  ) {
    return reject('stable-pane-adopted')
  }
  if (state.result.isReattach) {
    return reject('provider-reattached')
  }
  // The preflight 'isClaudeLaunch' regex also matches `echo claude`; require a
  // consistently planned direct Claude invocation at the effective spawn command.
  // Even this is classification-only, never proof of authenticated Claude login.
  if (!hasPlannedDirectClaudeLaunch(state)) {
    return reject('not-claude-launch')
  }
  if (!(state.provider instanceof LocalPtyProvider)) {
    return reject('provider-mismatch')
  }
  if (state.args.connectionId !== undefined && state.args.connectionId !== null) {
    return reject('remote-runtime')
  }
  if (state.isDaemonHostSpawn) {
    return reject('daemon-runtime')
  }
  if (
    state.codexSelectionTarget.runtime !== 'host' ||
    state.expectedWslDistro ||
    (state.result.wslDistro !== undefined && state.result.wslDistro !== null)
  ) {
    return reject('wsl-runtime')
  }
  if (
    outcome.result.id !== state.result.id ||
    outcome.result.incarnationId !== state.result.incarnationId
  ) {
    return reject('provider-result-mismatch')
  }
  if (
    !state.result.id.trim() ||
    state.result.id.length > 512 ||
    !isPtyIncarnationId(state.result.incarnationId) ||
    state.result.exitedBeforeSpawnReply
  ) {
    return reject('missing-pty-identity')
  }
  const launchToken = state.args.launchToken
  const effectiveLaunchToken = state.spawnOptions.env?.ORCA_AGENT_LAUNCH_TOKEN
  if (
    !state.args.launchConfig ||
    typeof launchToken !== 'string' ||
    launchToken.length === 0 ||
    launchToken.length > 128 ||
    typeof effectiveLaunchToken !== 'string' ||
    effectiveLaunchToken.length === 0
  ) {
    return reject('missing-launch-token')
  }
  if (effectiveLaunchToken !== launchToken) {
    return reject('launch-token-mismatch')
  }
  const pane = readCommittedPaneIdentity(state)
  if (typeof pane === 'string') {
    return reject(pane)
  }
  const evidence = Object.freeze({
    version: 1 as const,
    provider: 'local-pty' as const,
    spawnState: 'fresh-committed' as const,
    ptyId: state.result.id,
    incarnationId: state.result.incarnationId,
    worktreeId: pane.worktreeId,
    tabId: pane.tabId,
    leafId: pane.leafId,
    paneKey: pane.paneKey,
    launchTokenHash: createHash('sha256').update(effectiveLaunchToken).digest('hex'),
    accountEvidence: Object.freeze({
      status: 'missing' as const,
      reason: 'authenticated-managed-account-not-bound-to-effective-environment' as const
    })
  })
  return Object.freeze({ accepted: true, evidence })
}

/** Internal main-process receipt. It is never serialized or returned to a caller. */
export function recordCommittedLocalPtySpawnEvidence(
  runtime: CommittedLocalPtySpawnEvidenceRuntime | undefined,
  state: RuntimePtySpawnState,
  outcome: PtySpawnOutcome
): boolean {
  if (!runtime) {
    return false
  }
  try {
    const validation = validateCommittedLocalPtySpawnEvidence(state, outcome)
    if (!validation.accepted) {
      return false
    }
    const store = evidenceStoreFor(runtime)
    return store.record(validation.evidence, (listener) =>
      runtime.subscribeToPtyExit(validation.evidence.ptyId, listener)
    )
  } catch {
    // Evidence collection must never change the success or failure of an ordinary PTY spawn.
    return false
  }
}

/** Main-only lookup for a future host correlator and focused tests. */
export function readCommittedLocalPtySpawnEvidence(
  runtime: CommittedLocalPtySpawnEvidenceRuntime | undefined,
  ptyId: string,
  incarnationId: string
): CommittedLocalPtySpawnEvidence | null {
  return runtime ? (evidenceByRuntime.get(runtime)?.read(ptyId, incarnationId) ?? null) : null
}

/** Retirement is incarnation-fenced so an old exit cannot erase evidence for a replacement. */
export function retireCommittedLocalPtySpawnEvidence(
  runtime: CommittedLocalPtySpawnEvidenceRuntime | undefined,
  ptyId: string,
  incarnationId: string
): void {
  if (runtime) {
    evidenceByRuntime.get(runtime)?.remove(ptyId, incarnationId)
  }
}
