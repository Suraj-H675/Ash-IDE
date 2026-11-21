import { sameEndpointIdentity } from '../daemon/endpoint/identity/daemon-endpoint-incarnation'
import type { DaemonEndpointIdentity } from '../daemon/protocol/daemon-hello-protocol'
import type { ConnectedSessionInventory } from '../daemon/providers/adapter/daemon-pty-session-inventory'
import type { DaemonPtyAdapter } from '../daemon/providers/adapter/daemon-pty-adapter'
import { isAgentSessionOwnerBinding } from '../../shared/agent-session/agent-session-host-authority'
import { DegradedDaemonPtyProvider } from '../daemon/providers/routing/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../daemon/providers/lifecycle/daemon-provider-routing'
import { getDaemonProvider } from '../daemon/providers/lifecycle/daemon-provider-state'
import type {
  UpdatePreflightUnknownReason,
  UpdateRuntimeCensus
} from '../../shared/update-preflight-types'

const MAX_DAEMON_GENERATIONS = 16
const MAX_CENSUS_SESSIONS = 10_000
const FALLBACK_LIST_TIMEOUT_MS = 2_000
const DAEMON_LIST_TIMEOUT_MS = 2_500

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

function count(value: number): { state: 'known'; count: number } {
  return { state: 'known', count: value }
}

function unknown<T extends UpdatePreflightUnknownReason>(
  reason: T
): {
  state: 'unknown'
  reason: T
} {
  return { state: 'unknown', reason }
}

function providerAgentInventory(): UpdateRuntimeCensus['providerAgentSessions'] {
  return { state: 'unknown', reason: 'provider-agent-inventory-unavailable' }
}

function pendingWrites(): UpdateRuntimeCensus['pendingDiskWrites'] {
  return { state: 'unknown', reason: 'pending-write-census-unavailable' }
}

function hostOwnership(): UpdateRuntimeCensus['hostOwnership'] {
  return { state: 'unknown', reason: 'exclusive-host-ownership-unavailable' }
}

function censusWithUnknownRuntime(
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
    Number.isSafeInteger(value.startedAtMs) &&
    Number(value.startedAtMs) > 0 &&
    'launchNonce' in value &&
    typeof value.launchNonce === 'string' &&
    value.launchNonce.length > 0 &&
    value.launchNonce.length <= 512
  )
}

function validIdentity(adapter: UpdateCensusDaemonAdapter): DaemonEndpointIdentity | null {
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

function sameProvider(
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

function isConnectedInventory(
  value: unknown
): value is Extract<ConnectedSessionInventory, { state: 'complete' }> {
  if (typeof value !== 'object' || value === null || !('state' in value)) {
    return false
  }
  return (
    value.state === 'complete' &&
    'identity' in value &&
    isDaemonIdentity(value.identity) &&
    'sessions' in value &&
    Array.isArray(value.sessions) &&
    value.sessions.length <= MAX_CENSUS_SESSIONS &&
    'agentOwnershipComplete' in value &&
    typeof value.agentOwnershipComplete === 'boolean' &&
    value.sessions.every(
      (session) =>
        typeof session === 'object' &&
        session !== null &&
        'sessionId' in session &&
        typeof session.sessionId === 'string' &&
        session.sessionId.length > 0 &&
        session.sessionId.length <= 512 &&
        'isAlive' in session &&
        session.isAlive === true &&
        (!('agentSessionOwners' in session) ||
          (Array.isArray(session.agentSessionOwners) &&
            session.agentSessionOwners.every(isAgentSessionOwnerBinding)))
    )
  )
}

function isUnknownInventory(
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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

function readWindowCount(
  dependencies: UpdateRuntimeCensusDependencies
):
  | { state: 'known'; count: number }
  | { state: 'unknown'; reason: 'window-inventory-unavailable' } {
  try {
    const windowCount = dependencies.getWindowCount()
    return Number.isSafeInteger(windowCount) && windowCount >= 0
      ? count(windowCount)
      : unknown('window-inventory-unavailable')
  } catch {
    return unknown('window-inventory-unavailable')
  }
}

function stableWindowCount(
  before: UpdateRuntimeCensus['windows'],
  after: UpdateRuntimeCensus['windows']
): UpdateRuntimeCensus['windows'] {
  return before.state === 'known' && after.state === 'known' && before.count === after.count
    ? after
    : unknown('window-inventory-unavailable')
}

export async function collectUpdateRuntimeCensus(
  dependencies: UpdateRuntimeCensusDependencies
): Promise<UpdateRuntimeCensus> {
  const observedAtMs = dependencies.now?.() ?? Date.now()
  const windows = readWindowCount(dependencies)

  let provider: UpdateCensusProvider | null
  try {
    provider = dependencies.getProvider()
  } catch {
    return censusWithUnknownRuntime(observedAtMs, windows, 'daemon-unavailable')
  }
  if (
    !provider ||
    typeof provider.identity !== 'object' ||
    provider.identity === null ||
    !Array.isArray(provider.adapters) ||
    provider.adapters.length === 0
  ) {
    return censusWithUnknownRuntime(observedAtMs, windows, 'daemon-unavailable')
  }
  if (provider.adapters.length > MAX_DAEMON_GENERATIONS) {
    return censusWithUnknownRuntime(observedAtMs, windows, 'generation-limit-exceeded')
  }

  const before = provider.adapters.map(validIdentity)
  if (before.some((identity) => identity === null)) {
    return censusWithUnknownRuntime(observedAtMs, windows, 'daemon-disconnected')
  }

  const results = await Promise.allSettled(
    provider.adapters.map((adapter) =>
      withTimeout(
        Promise.resolve().then(() => adapter.listSessionsIfAlreadyConnected()),
        DAEMON_LIST_TIMEOUT_MS
      )
    )
  )
  const defer = (reason: UpdatePreflightUnknownReason) =>
    censusWithUnknownRuntime(
      observedAtMs,
      stableWindowCount(windows, readWindowCount(dependencies)),
      reason
    )
  let afterProvider: UpdateCensusProvider | null
  try {
    afterProvider = dependencies.getProvider()
  } catch {
    afterProvider = null
  }
  if (!sameProvider(afterProvider, provider)) {
    return defer('provider-changed')
  }
  if (results.some((result) => result.status === 'rejected')) {
    return defer('inventory-partial')
  }

  const inventories = results.map((result) => (result as PromiseFulfilledResult<unknown>).value)
  if (
    !inventories.every(
      (inventory) => isConnectedInventory(inventory) || isUnknownInventory(inventory)
    )
  ) {
    return defer('inventory-invalid')
  }
  const unknownInventory = inventories.find(isUnknownInventory)
  if (unknownInventory) {
    const reason =
      unknownInventory.reason === 'daemon-disconnected' ||
      unknownInventory.reason === 'daemon-identity-changed' ||
      unknownInventory.reason === 'inventory-invalid'
        ? unknownInventory.reason
        : 'inventory-partial'
    return defer(reason)
  }

  const sessionsById = new Map<
    string,
    Extract<ConnectedSessionInventory, { state: 'complete' }>['sessions'][number]
  >()
  let agentOwnershipComplete = true
  const agentSessionDigests = new Set<string>()
  const completeInventories = inventories as Array<
    Extract<ConnectedSessionInventory, { state: 'complete' }>
  >
  for (let index = 0; index < completeInventories.length; index += 1) {
    const inventory = completeInventories[index]
    const identityBefore = before[index]
    const identityAfter = validIdentity(provider.adapters[index])
    if (
      !identityBefore ||
      !identityAfter ||
      !sameEndpointIdentity(identityBefore, inventory.identity) ||
      !sameEndpointIdentity(identityBefore, identityAfter)
    ) {
      return defer('daemon-identity-changed')
    }
    agentOwnershipComplete &&= inventory.agentOwnershipComplete
    for (const session of inventory.sessions) {
      if (!session.isAlive || !session.sessionId || sessionsById.has(session.sessionId)) {
        return defer('inventory-invalid')
      }
      sessionsById.set(session.sessionId, session)
      for (const owner of session.agentSessionOwners ?? []) {
        agentSessionDigests.add(owner.claim.identityDigest)
      }
    }
  }

  let fallbackIds: readonly string[] = []
  if (provider.listFallbackPtyIds) {
    try {
      fallbackIds = await withTimeout(provider.listFallbackPtyIds(), FALLBACK_LIST_TIMEOUT_MS)
    } catch {
      return defer('fallback-inventory-unavailable')
    }
    if (
      !Array.isArray(fallbackIds) ||
      fallbackIds.length > MAX_CENSUS_SESSIONS ||
      fallbackIds.some((id) => typeof id !== 'string' || id.length === 0) ||
      new Set(fallbackIds).size !== fallbackIds.length
    ) {
      return defer('inventory-invalid')
    }
    if (fallbackIds.length > 0) {
      agentOwnershipComplete = false
    }
    if (fallbackIds.some((id) => sessionsById.has(id))) {
      return defer('inventory-invalid')
    }
  }
  try {
    afterProvider = dependencies.getProvider()
  } catch {
    afterProvider = null
  }
  if (!sameProvider(afterProvider, provider)) {
    return defer('provider-changed')
  }
  const stableWindows = stableWindowCount(windows, readWindowCount(dependencies))
  if (sessionsById.size + fallbackIds.length > MAX_CENSUS_SESSIONS) {
    return censusWithUnknownRuntime(observedAtMs, stableWindows, 'generation-limit-exceeded')
  }

  return {
    observedAtMs,
    hostOwnership: hostOwnership(),
    daemonGenerations: count(provider.adapters.length),
    windows: stableWindows,
    ptys: count(sessionsById.size + fallbackIds.length),
    ptyOwnedAgentSessions: agentOwnershipComplete
      ? count(agentSessionDigests.size)
      : unknown('agent-owner-inventory-incomplete'),
    providerAgentSessions: providerAgentInventory(),
    pendingDiskWrites: pendingWrites()
  }
}

export function collectAshUpdateRuntimeCensus(
  getWindowCount: () => number
): Promise<UpdateRuntimeCensus> {
  return collectUpdateRuntimeCensus({
    getWindowCount,
    getProvider: () => {
      const provider = getDaemonProvider()
      if (!provider) {
        return null
      }
      return {
        identity: provider,
        adapters: [...getAllDaemonAdapters(provider)],
        ...(provider instanceof DegradedDaemonPtyProvider
          ? {
              listFallbackPtyIds: async () =>
                (await provider.fallback.listProcesses()).map((session) => session.id)
            }
          : {})
      }
    }
  })
}
