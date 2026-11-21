import { isAgentSessionOwnerBinding } from '../../../../shared/agent-session/agent-session-host-authority'
import { MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES } from '../../../../shared/claimed-agent-pty-owner'
import { cloneAgentSessionOwnerBinding } from '../../../../shared/claimed-agent-pty-owner-snapshot'
import { parsePtySessionId } from '../../../../shared/terminal/pty/lifecycle/pty-session-id-format'
import { AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION } from '../../protocol/daemon-protocol-version'
import type { DaemonEndpointIdentity } from '../../protocol/daemon-hello-protocol'
import type { SessionState, ShellReadyState } from '../../protocol/daemon-rpc-contract'
import type { SessionInfo } from '../../protocol/daemon-session-info'

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

export function parseSessionInventoryRows(
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
