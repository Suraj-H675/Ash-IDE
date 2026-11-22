import { sameEndpointIdentity } from '../daemon/endpoint/identity/daemon-endpoint-incarnation'
import { DegradedDaemonPtyProvider } from '../daemon/providers/routing/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../daemon/providers/lifecycle/daemon-provider-routing'
import { getDaemonProvider } from '../daemon/providers/lifecycle/daemon-provider-state'
import {
  MAX_CENSUS_SESSIONS,
  isConnectedInventory,
  parseFallbackPtyIds,
  validIdentity,
  withTimeout,
  type UpdateCensusProvider
} from './update-runtime-census-evidence'

const MAX_DAEMON_GENERATIONS = 16
const CONNECTED_READ_TIMEOUT_MS = 900

export type ConnectedPtyPositiveEvidence = {
  ptySessions: number
  ptyOwnedAgentSessions: number
}

const NONE: ConnectedPtyPositiveEvidence = Object.freeze({
  ptySessions: 0,
  ptyOwnedAgentSessions: 0
})

function activeProvider(): UpdateCensusProvider | null {
  const provider = getDaemonProvider()
  if (!provider) {
    return null
  }
  return {
    identity: provider,
    adapters: getAllDaemonAdapters(provider),
    ...(provider instanceof DegradedDaemonPtyProvider
      ? {
          listFallbackPtyIds: async () =>
            (await provider.fallback.listProcesses()).map((session) => session.id)
        }
      : {})
  }
}

/**
 * Count only sessions returned by an already-authenticated, still-identical
 * daemon connection. Do not reconnect, launch, stop, close admission, or treat
 * a missing/partial inventory as a verified zero. The caller always publishes
 * an UNKNOWN inventory with these positive lower bounds, never a writer fence.
 */
export async function observeConnectedPtyPositiveEvidence(
  getProvider: () => UpdateCensusProvider | null = activeProvider
): Promise<ConnectedPtyPositiveEvidence> {
  let provider: UpdateCensusProvider | null
  try {
    provider = getProvider()
  } catch {
    return NONE
  }
  if (
    !provider ||
    !Array.isArray(provider.adapters) ||
    provider.adapters.length > MAX_DAEMON_GENERATIONS
  ) {
    return NONE
  }
  const initial = provider.adapters.map(validIdentity)
  const results = await Promise.allSettled([
    ...provider.adapters.map((adapter, index) =>
      initial[index]
        ? withTimeout(
            Promise.resolve().then(() => adapter.listSessionsIfAlreadyConnected()),
            CONNECTED_READ_TIMEOUT_MS
          )
        : Promise.resolve(null)
    ),
    provider.listFallbackPtyIds
      ? withTimeout(
          Promise.resolve().then(() => provider.listFallbackPtyIds?.()),
          CONNECTED_READ_TIMEOUT_MS
        )
      : Promise.resolve(null)
  ])
  const ptyIds = new Set<string>()
  const ownerDigests = new Set<string>()
  for (let index = 0; index < provider.adapters.length; index += 1) {
    const result = results[index]
    const before = initial[index]
    if (
      !before ||
      !result ||
      result.status !== 'fulfilled' ||
      !isConnectedInventory(result.value)
    ) {
      continue
    }
    const after = validIdentity(provider.adapters[index])
    if (
      !after ||
      !sameEndpointIdentity(before, after) ||
      !sameEndpointIdentity(before, result.value.identity)
    ) {
      continue
    }
    for (const session of result.value.sessions) {
      if (ptyIds.size >= MAX_CENSUS_SESSIONS) break
      ptyIds.add(session.sessionId)
      for (const owner of session.agentSessionOwners ?? []) {
        if (ownerDigests.size >= MAX_CENSUS_SESSIONS) break
        ownerDigests.add(owner.claim.identityDigest)
      }
    }
  }
  const fallback = results.at(-1)
  if (fallback?.status === 'fulfilled' && fallback.value !== null && fallback.value !== undefined) {
    const parsed = parseFallbackPtyIds(fallback.value)
    for (const id of parsed.ids) {
      if (ptyIds.size >= MAX_CENSUS_SESSIONS) break
      ptyIds.add(id)
    }
  }
  return { ptySessions: ptyIds.size, ptyOwnedAgentSessions: ownerDigests.size }
}
