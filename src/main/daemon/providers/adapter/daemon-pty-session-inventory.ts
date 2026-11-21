import { emitPtyListeners, createPtyExitPayload } from './daemon-pty-listener-emission'
import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import {
  isAgentSessionOwnerBinding,
  type AgentSessionOwnerBinding
} from '../../../../shared/agent-session/agent-session-host-authority'
import { MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES } from '../../../../shared/claimed-agent-pty-owner'
import { cloneAgentSessionOwnerBinding } from '../../../../shared/claimed-agent-pty-owner-snapshot'
import { recordAuthenticatedInventory } from '../../observability/daemon-audit-classifier'
import { isMissingWindowsNamedPipeError } from '../../endpoint/identity/daemon-endpoint-errors'
import { sameEndpointIdentity } from '../../endpoint/identity/daemon-endpoint-incarnation'
import { DaemonPtyProcessInspection } from './daemon-pty-process-inspection'
import { remainingDaemonRequestTimeoutMs } from '../../launch/daemon-request-deadline'
import { parsePtySessionId } from '../../../../shared/terminal/pty/lifecycle/pty-session-id-format'
import { AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION } from '../../protocol/daemon-protocol-version'
import type { DaemonEndpointIdentity } from '../../protocol/daemon-hello-protocol'
import type {
  ListSessionsResult,
  SessionState,
  ShellReadyState
} from '../../protocol/daemon-rpc-contract'
import type { SessionInfo } from '../../protocol/daemon-session-info'
import { PtyProcessListAdmission } from '../../../providers/pty-process-list-admission'
import type { PtyProcessInfo } from '../../../providers/pty-provider-contract'

const READ_ONLY_CENSUS_TIMEOUT_MS = 2_000
const MAX_READ_ONLY_CENSUS_SESSIONS = 10_000

export type ConnectedSessionInventory =
  | {
      state: 'complete'
      identity: DaemonEndpointIdentity
      sessions: SessionInfo[]
      agentOwnershipComplete: boolean
    }
  | {
      state: 'unknown'
      reason:
        | 'daemon-disconnected'
        | 'daemon-identity-changed'
        | 'inventory-unavailable'
        | 'inventory-invalid'
    }

const SESSION_STATES = new Set<SessionState>([
  'created',
  'spawning',
  'running',
  'exiting',
  'exited'
])
const SHELL_READY_STATES = new Set<ShellReadyState>([
  'pending',
  'ready',
  'timed_out',
  'unsupported'
])

function isSessionInventory(value: unknown): value is { sessions: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessions' in value &&
    Array.isArray(value.sessions) &&
    value.sessions.length <= MAX_READ_ONLY_CENSUS_SESSIONS
  )
}

function parseSessionInventoryRows(
  value: unknown,
  protocolVersion: number
): { sessions: SessionInfo[]; agentOwnershipComplete: boolean } | null {
  if (!isSessionInventory(value)) {
    return null
  }
  const ids = new Set<string>()
  const sessions: SessionInfo[] = []
  let agentOwnershipComplete = protocolVersion >= AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION
  for (const raw of value.sessions) {
    if (typeof raw !== 'object' || raw === null) {
      return null
    }
    const row = raw as Record<string, unknown>
    if (
      typeof row.sessionId !== 'string' ||
      row.sessionId.length === 0 ||
      row.sessionId.length > 512 ||
      ids.has(row.sessionId) ||
      row.isAlive !== true ||
      typeof row.state !== 'string' ||
      !SESSION_STATES.has(row.state as SessionState) ||
      row.state === 'exited' ||
      typeof row.shellState !== 'string' ||
      !SHELL_READY_STATES.has(row.shellState as ShellReadyState) ||
      (row.pid !== null && (!Number.isSafeInteger(row.pid) || Number(row.pid) <= 0)) ||
      (row.cwd !== null && typeof row.cwd !== 'string') ||
      !Number.isSafeInteger(row.cols) ||
      Number(row.cols) < 0 ||
      !Number.isSafeInteger(row.rows) ||
      Number(row.rows) < 0 ||
      !Number.isFinite(row.createdAt)
    ) {
      return null
    }
    try {
      parsePtySessionId(row.sessionId)
    } catch {
      return null
    }
    ids.add(row.sessionId)
    const owners = row.agentSessionOwners
    if (owners === undefined) {
      agentOwnershipComplete = false
    } else if (
      !Array.isArray(owners) ||
      owners.length > MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES ||
      !owners.every((owner) => isAgentSessionOwnerBinding(owner) && owner.phase === 'live')
    ) {
      return null
    }
    sessions.push({
      sessionId: row.sessionId,
      state: row.state as SessionState,
      shellState: row.shellState as ShellReadyState,
      isAlive: true,
      pid: row.pid as number | null,
      cwd: row.cwd as string | null,
      cols: row.cols as number,
      rows: row.rows as number,
      createdAt: row.createdAt as number,
      ...(owners === undefined
        ? {}
        : { agentSessionOwners: owners.map(cloneAgentSessionOwnerBinding) })
    })
  }
  return { sessions, agentOwnershipComplete }
}

export abstract class DaemonPtySessionInventory extends DaemonPtyProcessInspection {
  async listSessionsIfAlreadyConnected(): Promise<ConnectedSessionInventory> {
    const identity = this.client.getDaemonIdentity()
    const authenticatedIdentity = this.getLastAuthenticatedDaemonIdentity()
    if (
      !this.client.isConnected() ||
      !identity ||
      !authenticatedIdentity ||
      !sameEndpointIdentity(identity, authenticatedIdentity)
    ) {
      return { state: 'unknown', reason: 'daemon-disconnected' }
    }

    let response: unknown
    try {
      response = await this.client.request<unknown>(
        'listSessions',
        undefined,
        READ_ONLY_CENSUS_TIMEOUT_MS
      )
    } catch {
      return { state: 'unknown', reason: 'inventory-unavailable' }
    }

    const currentIdentity = this.client.getDaemonIdentity()
    const currentAuthenticatedIdentity = this.getLastAuthenticatedDaemonIdentity()
    if (
      !currentIdentity ||
      !currentAuthenticatedIdentity ||
      !sameEndpointIdentity(identity, currentIdentity) ||
      !sameEndpointIdentity(identity, currentAuthenticatedIdentity)
    ) {
      return { state: 'unknown', reason: 'daemon-identity-changed' }
    }
    const parsed = parseSessionInventoryRows(response, this.protocolVersion)
    if (!parsed) {
      return { state: 'unknown', reason: 'inventory-invalid' }
    }
    return { state: 'complete', identity, ...parsed }
  }

  async listProcesses(opts?: {
    deadlineMs?: number
    ptyIds?: readonly string[]
    targetOwnerOnly?: boolean
  }): Promise<PtyProcessInfo[]> {
    try {
      // Retry connect and inventory together; reconcile only once after both succeed.
      // Share the teardown deadline so handshake cannot consume a fresh budget before inventory.
      return await this.withDaemonRetry(async () => {
        await this.ensureConnected(opts?.deadlineMs)
        const inventory = this.ptyInventory.begin()
        try {
          const result = await this.client.request<ListSessionsResult>(
            'listSessions',
            undefined,
            remainingDaemonRequestTimeoutMs(opts?.deadlineMs)
          )
          const admission = new PtyProcessListAdmission()
          const processes: PtyProcessInfo[] = []
          const aliveSessionIds = new Map<string, string | undefined>()
          // A target read skips unrelated rows and never reconciles them as absent.
          const requested = opts?.targetOwnerOnly && opts.ptyIds ? new Set(opts.ptyIds) : undefined
          for (const session of result.sessions) {
            if (requested && !requested.has(session.sessionId)) {
              continue
            }
            if (!session.isAlive) {
              continue
            }
            aliveSessionIds.set(session.sessionId, session.incarnationId)
            const { worktreeId } = parsePtySessionId(session.sessionId)
            processes.push(
              admission.admit({
                id: session.sessionId,
                ...(session.incarnationId ? { incarnationId: session.incarnationId } : {}),
                ...(session.pid ? { rootProcessId: session.pid } : {}),
                // Spawn cwd remains authoritative until the daemon reports live cwd.
                cwd: session.cwd ?? this.initialCwds.get(session.sessionId) ?? '',
                // The listing carries no title; attach seeds the live one from the daemon snapshot.
                title: '',
                ...(session.foregroundProcess
                  ? { foregroundProcess: session.foregroundProcess }
                  : {}),
                ...(worktreeId ? { worktreeId } : {}),
                ...(session.terminalHandle ? { terminalHandle: session.terminalHandle } : {}),
                ...(session.paneKey ? { paneKey: session.paneKey } : {}),
                ...(session.wslDistro !== undefined ? { wslDistro: session.wslDistro } : {}),
                ...(session.wslGuestRoot ? { wslGuestRoot: session.wslGuestRoot } : {}),
                ...(session.state === 'exiting' ? { exiting: true as const } : {}),
                ...this.validatedAgentSessionOwners(session.agentSessionOwners)
              })
            )
          }
          if (!requested) {
            this.ptyInventory.commit(inventory, aliveSessionIds)
            this.publishAuditObservation(
              recordAuthenticatedInventory(this.auditContext, this.exactDaemonIncarnation)
            )
          }
          return processes
        } finally {
          this.ptyInventory.end(inventory)
        }
      })
    } catch (error) {
      const missingAuthenticatedToken = this.isRetiredEndpointTokenMissing()
      const missingNamedPipe = isMissingWindowsNamedPipeError(error)
      this.observeAuditFailure(
        missingAuthenticatedToken
          ? 'token_missing_after_authenticated_disconnect'
          : 'inventory_failed',
        this.exactDaemonIncarnation,
        [
          ...(missingAuthenticatedToken ? (['token_file'] as const) : []),
          ...(missingNamedPipe ? (['windows_named_pipe'] as const) : [])
        ],
        missingNamedPipe ? 'windows_named_pipe_missing' : undefined
      )
      throw error
    }
  }

  protected validatedAgentSessionOwners(
    owners: unknown
  ): { agentSessionOwners: AgentSessionOwnerBinding[] } | Record<string, never> {
    if (owners === undefined) {
      return {}
    }
    if (
      !Array.isArray(owners) ||
      owners.length > MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES ||
      !owners.every((owner) => isAgentSessionOwnerBinding(owner) && owner.phase === 'live')
    ) {
      throw new Error('agent_session_ownership_unknown')
    }
    return owners.length > 0
      ? { agentSessionOwners: owners.map(cloneAgentSessionOwnerBinding) }
      : {}
  }

  // Manage Sessions needs details omitted from the generic listProcesses contract.
  async listSessions(): Promise<SessionInfo[]> {
    await this.ensureConnected()
    const result = await this.client.request<ListSessionsResult>('listSessions', undefined)
    return result.sessions
      .filter((s) => s.isAlive)
      .map((session) => ({
        ...session,
        ...this.validatedAgentSessionOwners(session.agentSessionOwners)
      }))
  }

  getActiveSessionIds(): string[] {
    return [...this.activeSessionIds]
  }

  // Daemon shutdown suppresses exit fanout; notify panes before teardown so they stop writing to dead PTYs.
  fanoutSyntheticExits(code: number, exit: { replacedByRestart?: true } = {}): void {
    const ids = [...this.activeSessionIds]
    this.activeSessionIds.clear()
    this.ptyInventory.reset()
    this.sessionsAwaitingDaemonRecovery.clear()
    this.writeRecoveryAttempted = false
    this.dirtySessionVersions.clear()
    this.lastFullCheckpointAt.clear()
    this.sessionsNeedingFullCheckpoint.clear()
    this.sessionsNeedingLiveCheckpoint.clear()
    this.sessionsNeedingContinuityCheckpoint.clear()
    this.overlayDeadlineWarnedSessionIds.clear()
    this.periodicDeadlineWarnedSessionIds.clear()
    this.nonFinalAdmissionDeniedSessionIds.clear()
    this.pausedProducerSessionIds.clear()
    this.producerResumesOwedOnReconnect.clear()
    this.stopCheckpointTimer()
    for (const id of ids) {
      this.coldRestoreCache.delete(id)
      // Match natural exit listeners: synthetic fanout preserves thrown errors.
      emitPtyListeners(this.exitListeners, (listener) =>
        listener(
          createPtyExitPayload(id, {
            code,
            incarnationId: this.sessionIncarnations.get(id),
            ...exit
          })
        )
      )
      this.sessionIncarnations.delete(id)
    }
  }

  async getDefaultShell(): Promise<string> {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/zsh'
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    if (process.platform === 'win32') {
      return [
        { name: 'PowerShell', path: 'powershell.exe' },
        { name: 'Command Prompt', path: 'cmd.exe' }
      ]
    }
    const shells = ['/bin/zsh', '/bin/bash', '/bin/sh']
    return shells.filter((s) => existsSync(s)).map((s) => ({ name: basename(s), path: s }))
  }
}
