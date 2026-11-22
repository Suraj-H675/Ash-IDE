import { sameEndpointIdentity } from '../daemon/endpoint/identity/daemon-endpoint-incarnation'
import type { DaemonEndpointIdentity } from '../daemon/protocol/daemon-hello-protocol'
import type { ConnectedSessionInventory } from '../daemon/providers/adapter/daemon-pty-session-inventory'
import type {
  UpdatePreflightUnknownReason,
  UpdateRuntimeCensus
} from '../../shared/update-preflight-types'
import {
  MAX_CENSUS_SESSIONS,
  censusWithUnknownRuntime,
  count,
  hostOwnership,
  isConnectedInventory,
  isUnknownInventory,
  observedLocalPendingWrite,
  parseFallbackPtyIds,
  pendingWrites,
  providerAgentInventory,
  readWindowCount,
  sameProvider,
  stableWindowCount,
  unknown,
  validIdentity,
  withTimeout
} from './update-runtime-census-evidence'
import type {
  UpdateCensusDaemonAdapter,
  UpdateCensusProvider,
  UpdateRuntimeCensusDependencies
} from './update-runtime-census-evidence'
import { recheckQuietRuntime } from './update-runtime-quiet-recheck'

export type {
  UpdateCensusDaemonAdapter,
  UpdateCensusProvider,
  UpdateRuntimeCensusDependencies
} from './update-runtime-census-evidence'

const MAX_DAEMON_GENERATIONS = 16
const FALLBACK_LIST_TIMEOUT_MS = 2_000
const DAEMON_LIST_TIMEOUT_MS = 2_500

export async function collectUpdateRuntimeCensus(
  dependencies: UpdateRuntimeCensusDependencies
): Promise<UpdateRuntimeCensus> {
  const observedAtMs = dependencies.now?.() ?? Date.now()
  const windows = readWindowCount(dependencies)
  const pendingAtStart = observedLocalPendingWrite(dependencies)
  const pendingObserved = () => Math.max(pendingAtStart, observedLocalPendingWrite(dependencies))

  let provider: UpdateCensusProvider | null
  try {
    provider = dependencies.getProvider()
  } catch {
    return censusWithUnknownRuntime(observedAtMs, windows, 'daemon-unavailable', pendingObserved())
  }
  if (
    !provider ||
    typeof provider.identity !== 'object' ||
    provider.identity === null ||
    !Array.isArray(provider.adapters) ||
    provider.adapters.length === 0
  ) {
    return censusWithUnknownRuntime(observedAtMs, windows, 'daemon-unavailable', pendingObserved())
  }
  if (provider.adapters.length > MAX_DAEMON_GENERATIONS) {
    return censusWithUnknownRuntime(
      observedAtMs,
      windows,
      'generation-limit-exceeded',
      pendingObserved()
    )
  }

  type StableInventory = {
    adapter: UpdateCensusDaemonAdapter
    identity: DaemonEndpointIdentity
    inventory: Extract<ConnectedSessionInventory, { state: 'complete' }>
  }

  let daemonReason: UpdatePreflightUnknownReason | undefined
  let ownerReason: UpdatePreflightUnknownReason | undefined
  const before = provider.adapters.map(validIdentity)
  const results = await Promise.allSettled(
    provider.adapters.map((adapter, index) => {
      if (!before[index]) {
        return Promise.resolve({ state: 'unknown', reason: 'daemon-disconnected' } as const)
      }
      return withTimeout(
        Promise.resolve().then(() => adapter.listSessionsIfAlreadyConnected()),
        DAEMON_LIST_TIMEOUT_MS
      )
    })
  )
  const stable: StableInventory[] = []
  for (let index = 0; index < provider.adapters.length; index += 1) {
    const result = results[index]
    const identityBefore = before[index]
    if (!identityBefore) {
      daemonReason ??= 'daemon-disconnected'
      ownerReason ??= 'daemon-disconnected'
      continue
    }
    if (!result || result.status === 'rejected') {
      daemonReason ??= 'inventory-partial'
      ownerReason ??= 'inventory-partial'
      continue
    }
    const inventory: unknown = result.value
    if (!isConnectedInventory(inventory) && !isUnknownInventory(inventory)) {
      daemonReason ??= 'inventory-invalid'
      ownerReason ??= 'inventory-invalid'
      continue
    }
    if (isUnknownInventory(inventory)) {
      const reason =
        inventory.reason === 'daemon-disconnected' ||
        inventory.reason === 'daemon-identity-changed' ||
        inventory.reason === 'inventory-invalid'
          ? inventory.reason
          : 'inventory-partial'
      daemonReason ??= reason
      ownerReason ??= reason
      continue
    }
    const identityAfter = validIdentity(provider.adapters[index])
    if (
      !identityAfter ||
      !sameEndpointIdentity(identityBefore, inventory.identity) ||
      !sameEndpointIdentity(identityBefore, identityAfter)
    ) {
      daemonReason ??= 'daemon-identity-changed'
      ownerReason ??= 'daemon-identity-changed'
      continue
    }
    stable.push({ adapter: provider.adapters[index], identity: identityBefore, inventory })
  }

  let afterProvider: UpdateCensusProvider | null
  let providerStableThroughRead = true
  try {
    afterProvider = dependencies.getProvider()
  } catch {
    afterProvider = null
  }
  if (!sameProvider(afterProvider, provider)) {
    providerStableThroughRead = false
    daemonReason ??= 'provider-changed'
    ownerReason ??= 'provider-changed'
  }

  let fallbackIds: readonly string[] = []
  let fallbackReason: UpdatePreflightUnknownReason | undefined
  if (provider.listFallbackPtyIds) {
    try {
      const parsed = parseFallbackPtyIds(
        await withTimeout(provider.listFallbackPtyIds(), FALLBACK_LIST_TIMEOUT_MS)
      )
      fallbackIds = parsed.ids
      fallbackReason = parsed.reason
    } catch {
      fallbackReason = 'fallback-inventory-unavailable'
    }
  }

  try {
    afterProvider = dependencies.getProvider()
  } catch {
    afterProvider = null
  }
  if (!sameProvider(afterProvider, provider)) {
    providerStableThroughRead = false
    daemonReason ??= 'provider-changed'
    ownerReason ??= 'provider-changed'
  }
  if (!providerStableThroughRead && provider.listFallbackPtyIds) {
    fallbackReason = 'provider-changed'
  }

  const stableInventories: StableInventory[] = []
  for (const observation of stable) {
    const identityAfterRead = validIdentity(observation.adapter)
    if (!identityAfterRead || !sameEndpointIdentity(observation.identity, identityAfterRead)) {
      daemonReason ??= 'daemon-identity-changed'
      ownerReason ??= 'daemon-identity-changed'
      continue
    }
    stableInventories.push(observation)
  }

  const sessionsById = new Map<
    string,
    Extract<ConnectedSessionInventory, { state: 'complete' }>['sessions'][number]
  >()
  const agentSessionDigests = new Set<string>()
  let ownersComplete = true
  for (const { inventory } of stableInventories) {
    ownersComplete &&= inventory.agentOwnershipComplete
    for (const session of inventory.sessions) {
      if (sessionsById.has(session.sessionId)) {
        daemonReason ??= 'inventory-invalid'
        ownerReason ??= 'inventory-invalid'
        continue
      }
      if (sessionsById.size >= MAX_CENSUS_SESSIONS) {
        daemonReason ??= 'generation-limit-exceeded'
        ownerReason ??= 'generation-limit-exceeded'
        continue
      }
      sessionsById.set(session.sessionId, session)
      for (const owner of session.agentSessionOwners ?? []) {
        if (agentSessionDigests.has(owner.claim.identityDigest)) {
          continue
        }
        if (agentSessionDigests.size >= MAX_CENSUS_SESSIONS) {
          ownerReason ??= 'generation-limit-exceeded'
          ownersComplete = false
          continue
        }
        agentSessionDigests.add(owner.claim.identityDigest)
      }
    }
  }
  const sessionIds = new Set(sessionsById.keys())
  if (fallbackIds.some((id) => sessionIds.has(id))) {
    fallbackIds = fallbackIds.filter((id) => !sessionIds.has(id))
    fallbackReason ??= 'inventory-invalid'
  }
  if (fallbackIds.length > MAX_CENSUS_SESSIONS - sessionsById.size) {
    fallbackIds = fallbackIds.slice(0, MAX_CENSUS_SESSIONS - sessionsById.size)
    fallbackReason ??= 'generation-limit-exceeded'
  }
  if (fallbackReason) {
    ownerReason ??= fallbackReason
  }
  if (fallbackIds.length > 0 || fallbackReason) {
    ownersComplete = false
    ownerReason ??= 'agent-owner-inventory-incomplete'
  }
  if (!ownersComplete) {
    ownerReason ??= 'agent-owner-inventory-incomplete'
  }
  // The common Settings diagnostic runs in an open window. Never add a
  // second daemon round-trip when a window already makes preflight busy.
  const windowsAtIdleGate =
    windows.state === 'known' && windows.count === 0 ? readWindowCount(dependencies) : windows
  const windowsBeforeReplay = stableWindowCount(windows, windowsAtIdleGate)
  // An authenticated daemon can gain a PTY after the first inventory reply.
  // Re-read only an apparently quiet and fully enumerated runtime. This
  // narrows the blind spot, but cannot replace an exclusive maintenance fence.
  let latePtyLowerBound = 0
  let lateOwnerLowerBound = 0
  if (
    windowsBeforeReplay.state === 'known' &&
    windowsBeforeReplay.count === 0 &&
    !daemonReason &&
    !ownerReason &&
    !fallbackReason &&
    providerStableThroughRead &&
    sessionsById.size === 0 &&
    fallbackIds.length === 0
  ) {
    const replay = await recheckQuietRuntime(
      stableInventories,
      provider,
      dependencies,
      DAEMON_LIST_TIMEOUT_MS,
      FALLBACK_LIST_TIMEOUT_MS
    )
    daemonReason ??= replay.daemonReason
    ownerReason ??= replay.ownerReason
    fallbackReason ??= replay.fallbackReason
    latePtyLowerBound = replay.observedPtys
    lateOwnerLowerBound = replay.observedAgentOwners
  }
  const stableWindows = stableWindowCount(windowsBeforeReplay, readWindowCount(dependencies))
  const sessionLowerBound = Math.max(sessionsById.size + fallbackIds.length, latePtyLowerBound)
  const generationLowerBound = stableInventories.length

  return {
    observedAtMs,
    hostOwnership: hostOwnership(),
    daemonGenerations: daemonReason
      ? unknown(daemonReason, generationLowerBound)
      : count(provider.adapters.length),
    windows: stableWindows,
    ptys:
      daemonReason || fallbackReason
        ? unknown(daemonReason ?? fallbackReason ?? 'inventory-partial', sessionLowerBound)
        : count(sessionLowerBound),
    ptyOwnedAgentSessions: ownerReason
      ? unknown(ownerReason, Math.max(agentSessionDigests.size, lateOwnerLowerBound))
      : count(Math.max(agentSessionDigests.size, lateOwnerLowerBound)),
    providerAgentSessions: providerAgentInventory(),
    pendingDiskWrites: pendingWrites(pendingObserved())
  }
}
