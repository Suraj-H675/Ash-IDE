import { sameEndpointIdentity } from '../daemon/endpoint/identity/daemon-endpoint-incarnation'
import type { DaemonEndpointIdentity } from '../daemon/protocol/daemon-hello-protocol'
import type { ConnectedSessionInventory } from '../daemon/providers/adapter/daemon-pty-session-inventory'
import type { DaemonPtyAdapter } from '../daemon/providers/adapter/daemon-pty-adapter'
import { MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES } from '../../shared/claimed-agent-pty-owner'
import { isAgentSessionOwnerBinding } from '../../shared/agent-session/agent-session-host-authority'
import type {
  UpdatePreflightUnknownReason,
  UpdateRuntimeCensus
} from '../../shared/update-preflight-types'

export const MAX_CENSUS_SESSIONS = 10_000

export type ParsedFallbackPtyIds = {
  ids: string[]
  reason?: UpdatePreflightUnknownReason
}

export type UpdateCensusDaemonAdapter = Pick<
  DaemonPtyAdapter,
  'getDaemonIdentity' | 'getLastAuthenticatedDaemonIdentity' | 'listSessionsIfAlreadyConnected'
>

export type UpdateCensusProvider = {
  identity: object
  adapters: readonly UpdateCensusDaemonAdapter[]
  listFallbackPtyIds?: () => Promise<readonly string[]>
}

export type UpdateRuntimeCensusDependencies = {
  getWindowCount: () => number
  getProvider: () => UpdateCensusProvider | null
  now?: () => number
}

export function count(value: number): { state: 'known'; count: number } {
  return { state: 'known', count: value }
}

export function unknown<T extends UpdatePreflightUnknownReason>(
  reason: T,
  lowerBound = 0
): {
  state: 'unknown'
  reason: T
  lowerBound: number
} {
  return { state: 'unknown', reason, lowerBound }
}

export function providerAgentInventory(): UpdateRuntimeCensus['providerAgentSessions'] {
  return { state: 'unknown', reason: 'provider-agent-inventory-unavailable' }
}

export function pendingWrites(): UpdateRuntimeCensus['pendingDiskWrites'] {
  return { state: 'unknown', reason: 'pending-write-census-unavailable' }
}

export function hostOwnership(): UpdateRuntimeCensus['hostOwnership'] {
  return { state: 'unknown', reason: 'exclusive-host-ownership-unavailable' }
}

export function censusWithUnknownRuntime(
  observedAtMs: number,
  windows: UpdateRuntimeCensus['windows'],
  reason: UpdatePreflightUnknownReason
): UpdateRuntimeCensus {
  return {
    observedAtMs,
    hostOwnership: hostOwnership(),
    daemonGenerations: unknown(reason),
    windows,
    ptys: unknown(reason),
    ptyOwnedAgentSessions: unknown(
      reason === 'provider-agent-inventory-unavailable'
        ? 'agent-owner-inventory-incomplete'
        : reason
    ),
    providerAgentSessions: providerAgentInventory(),
    pendingDiskWrites: pendingWrites()
  }
}

function isDaemonIdentity(value: unknown): value is DaemonEndpointIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pid' in value &&
    Number.isSafeInteger(value.pid) &&
    Number(value.pid) > 0 &&
    'startedAtMs' in value &&
    typeof value.startedAtMs === 'number' &&
    Number.isFinite(value.startedAtMs) &&
    value.startedAtMs > 0 &&
    value.startedAtMs <= Number.MAX_SAFE_INTEGER &&
    'launchNonce' in value &&
    typeof value.launchNonce === 'string' &&
    value.launchNonce.length > 0 &&
    value.launchNonce.length <= 512
  )
}

export function validIdentity(adapter: UpdateCensusDaemonAdapter): DaemonEndpointIdentity | null {
  try {
    const active = adapter.getDaemonIdentity()
    const authenticated = adapter.getLastAuthenticatedDaemonIdentity()
    return isDaemonIdentity(active) &&
      isDaemonIdentity(authenticated) &&
      sameEndpointIdentity(active, authenticated)
      ? active
      : null
  } catch {
    return null
  }
}

export function sameProvider(
  current: UpdateCensusProvider | null,
  expected: UpdateCensusProvider
): current is UpdateCensusProvider {
  return (
    current !== null &&
    current.identity === expected.identity &&
    Array.isArray(current.adapters) &&
    current.adapters.length === expected.adapters.length &&
    current.adapters.every((adapter, index) => adapter === expected.adapters[index])
  )
}

export function isConnectedInventory(
  value: unknown
): value is Extract<ConnectedSessionInventory, { state: 'complete' }> {
  if (typeof value !== 'object' || value === null || !('state' in value)) {
    return false
  }
  const sessionIds = new Set<string>()
  return (
    value.state === 'complete' &&
    'identity' in value &&
    isDaemonIdentity(value.identity) &&
    'sessions' in value &&
    Array.isArray(value.sessions) &&
    value.sessions.length <= MAX_CENSUS_SESSIONS &&
    'agentOwnershipComplete' in value &&
    typeof value.agentOwnershipComplete === 'boolean' &&
    value.sessions.every((session) => {
      if (
        typeof session !== 'object' ||
        session === null ||
        !('sessionId' in session) ||
        typeof session.sessionId !== 'string' ||
        session.sessionId.length === 0 ||
        session.sessionId.length > 512 ||
        sessionIds.has(session.sessionId) ||
        !('isAlive' in session) ||
        session.isAlive !== true
      ) {
        return false
      }
      sessionIds.add(session.sessionId)
      return (
        (!value.agentOwnershipComplete || 'agentSessionOwners' in session) &&
        (!('agentSessionOwners' in session) ||
          (Array.isArray(session.agentSessionOwners) &&
            session.agentSessionOwners.length <= MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES &&
            session.agentSessionOwners.every(
              (owner) => isAgentSessionOwnerBinding(owner) && owner.phase === 'live'
            )))
      )
    })
  )
}

export function isUnknownInventory(
  value: unknown
): value is Extract<ConnectedSessionInventory, { state: 'unknown' }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    value.state === 'unknown' &&
    'reason' in value &&
    (value.reason === 'daemon-disconnected' ||
      value.reason === 'daemon-identity-changed' ||
      value.reason === 'inventory-unavailable' ||
      value.reason === 'inventory-invalid')
  )
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('bounded runtime inventory timed out')),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

export function readWindowCount(
  dependencies: UpdateRuntimeCensusDependencies
): UpdateRuntimeCensus['windows'] {
  try {
    const windowCount = dependencies.getWindowCount()
    return Number.isSafeInteger(windowCount) && windowCount >= 0
      ? count(windowCount)
      : unknown('window-inventory-unavailable')
  } catch {
    return unknown('window-inventory-unavailable')
  }
}

export function stableWindowCount(
  before: UpdateRuntimeCensus['windows'],
  after: UpdateRuntimeCensus['windows']
): UpdateRuntimeCensus['windows'] {
  return before.state === 'known' && after.state === 'known' && before.count === after.count
    ? after
    : unknown('window-inventory-unavailable')
}

export function parseFallbackPtyIds(value: unknown): ParsedFallbackPtyIds {
  if (!Array.isArray(value)) {
    return { ids: [], reason: 'inventory-invalid' }
  }
  const ids = new Set<string>()
  let reason: UpdatePreflightUnknownReason | undefined =
    value.length > MAX_CENSUS_SESSIONS ? 'generation-limit-exceeded' : undefined
  for (const entry of value.slice(0, MAX_CENSUS_SESSIONS)) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 512) {
      reason ??= 'inventory-invalid'
      continue
    }
    if (ids.has(entry)) {
      reason ??= 'inventory-invalid'
      continue
    }
    ids.add(entry)
  }
  return { ids: [...ids], ...(reason ? { reason } : {}) }
}
