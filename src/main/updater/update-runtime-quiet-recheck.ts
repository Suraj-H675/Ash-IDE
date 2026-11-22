import { sameEndpointIdentity } from '../daemon/endpoint/identity/daemon-endpoint-incarnation'
import type { DaemonEndpointIdentity } from '../daemon/protocol/daemon-hello-protocol'
import type { UpdatePreflightUnknownReason } from '../../shared/update-preflight-types'
import {
  isConnectedInventory,
  isUnknownInventory,
  parseFallbackPtyIds,
  sameProvider,
  validIdentity,
  withTimeout
} from './update-runtime-census-evidence'
import type {
  UpdateCensusDaemonAdapter,
  UpdateCensusProvider,
  UpdateRuntimeCensusDependencies
} from './update-runtime-census-evidence'

type InitialQuietAdapter = {
  adapter: UpdateCensusDaemonAdapter
  identity: DaemonEndpointIdentity
}

export type QuietRuntimeRecheck = {
  daemonReason?: UpdatePreflightUnknownReason
  ownerReason?: UpdatePreflightUnknownReason
  fallbackReason?: UpdatePreflightUnknownReason
  observedPtys: number
  observedAgentOwners: number
}

/** A second observation narrows the idle TOCTOU gap; it never establishes a writer fence. */
export async function recheckQuietRuntime(
  initial: readonly InitialQuietAdapter[],
  provider: UpdateCensusProvider,
  dependencies: UpdateRuntimeCensusDependencies,
  daemonTimeoutMs: number,
  fallbackTimeoutMs: number
): Promise<QuietRuntimeRecheck> {
  const result: QuietRuntimeRecheck = { observedPtys: 0, observedAgentOwners: 0 }
  const replays = await Promise.allSettled(
    initial.map(({ adapter }) =>
      withTimeout(
        Promise.resolve().then(() => adapter.listSessionsIfAlreadyConnected()),
        daemonTimeoutMs
      )
    )
  )

  for (let index = 0; index < initial.length; index += 1) {
    const before = initial[index]
    const replay = replays[index]
    if (!replay || replay.status === 'rejected') {
      result.daemonReason ??= 'inventory-partial'
      result.ownerReason ??= 'inventory-partial'
      continue
    }
    const inventory: unknown = replay.value
    if (!isConnectedInventory(inventory)) {
      const reason: UpdatePreflightUnknownReason = isUnknownInventory(inventory)
        ? inventory.reason === 'inventory-unavailable'
          ? 'inventory-partial'
          : inventory.reason
        : 'inventory-invalid'
      result.daemonReason ??= reason
      result.ownerReason ??= reason
      continue
    }
    const after = validIdentity(before.adapter)
    // A replacement generation can legitimately report newly alive PTYs.
    // Preserve their positive count only if the reply is authenticated to
    // the adapter's *current* incarnation; do not credit stale/spoofed replies.
    const replyAuthenticated = after && sameEndpointIdentity(after, inventory.identity)
    if (replyAuthenticated && inventory.sessions.length > 0) {
      result.observedPtys = Math.max(result.observedPtys, inventory.sessions.length)
      result.observedAgentOwners = Math.max(
        result.observedAgentOwners,
        new Set(
          inventory.sessions.flatMap((session) =>
            (session.agentSessionOwners ?? []).map((owner) => owner.claim.identityDigest)
          )
        ).size
      )
    }
    if (
      !after ||
      !sameEndpointIdentity(before.identity, inventory.identity) ||
      !sameEndpointIdentity(before.identity, after)
    ) {
      result.daemonReason ??= 'daemon-identity-changed'
      result.ownerReason ??= 'daemon-identity-changed'
      continue
    }
    if (inventory.sessions.length > 0) {
      result.daemonReason ??= 'inventory-partial'
      result.ownerReason ??= 'inventory-partial'
    }
    if (!inventory.agentOwnershipComplete) {
      result.ownerReason ??= 'agent-owner-inventory-incomplete'
    }
  }

  if (provider.listFallbackPtyIds) {
    try {
      const fallback = parseFallbackPtyIds(
        await withTimeout(provider.listFallbackPtyIds(), fallbackTimeoutMs)
      )
      if (fallback.reason) {
        result.fallbackReason ??= fallback.reason
        result.ownerReason ??= fallback.reason
      }
      if (fallback.ids.length > 0) {
        result.observedPtys = Math.max(result.observedPtys, fallback.ids.length)
        result.fallbackReason ??= 'inventory-partial'
        result.ownerReason ??= 'agent-owner-inventory-incomplete'
      }
    } catch {
      result.fallbackReason ??= 'fallback-inventory-unavailable'
      result.ownerReason ??= 'fallback-inventory-unavailable'
    }
  }

  let current: UpdateCensusProvider | null
  try {
    current = dependencies.getProvider()
  } catch {
    current = null
  }
  if (!sameProvider(current, provider)) {
    result.daemonReason = 'provider-changed'
    result.ownerReason = 'provider-changed'
    if (provider.listFallbackPtyIds) {
      result.fallbackReason = 'provider-changed'
    }
  }
  // Fallback enumeration can itself span a reconnect. Verify all generations
  // again after that last await, not only after their individual RPCs.
  for (const before of initial) {
    const identity = validIdentity(before.adapter)
    if (!identity || !sameEndpointIdentity(before.identity, identity)) {
      result.daemonReason ??= 'daemon-identity-changed'
      result.ownerReason ??= 'daemon-identity-changed'
    }
  }
  return result
}
