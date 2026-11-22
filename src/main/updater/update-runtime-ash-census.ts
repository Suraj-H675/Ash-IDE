import { DegradedDaemonPtyProvider } from '../daemon/providers/routing/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../daemon/providers/lifecycle/daemon-provider-routing'
import { getDaemonProvider } from '../daemon/providers/lifecycle/daemon-provider-state'
import { observedHostedStructuredAgentChildren } from '../native-chat/agent-session-wire/structured-agent-session-positive-evidence'
import type { UpdateRuntimeCensus } from '../../shared/update-preflight-types'
import { collectUpdateRuntimeCensus } from './update-runtime-census'
import { observeLocalRuntimeWriterActivity } from './update-runtime-provider-socket-observation'
import { pendingWrites, providerAgentInventory } from './update-runtime-census-evidence'

/** Bind the read-only census to the actual desktop providers and Store. */
export function collectAshUpdateRuntimeCensus(
  getWindowCount: () => number,
  getLocalPendingWriteActivity: () => boolean,
  userDataPath?: string
): Promise<UpdateRuntimeCensus> {
  // No runtime/daemon is launched by this diagnostic. A missing or denied
  // socket reports zero positive evidence but never a verified idle inventory.
  const remote = userDataPath
    ? observeLocalRuntimeWriterActivity(userDataPath).catch(() => ({
        providerChildren: 0,
        pendingWrites: 0 as const,
        ptySessions: 0,
        ptyOwnedAgentSessions: 0
      }))
    : Promise.resolve({
        providerChildren: 0,
        pendingWrites: 0,
        ptySessions: 0,
        ptyOwnedAgentSessions: 0
      })
  const local = collectUpdateRuntimeCensus({
    getWindowCount,
    getLocalPendingWriteActivity,
    getLocalProviderAgentSessionCount: observedHostedStructuredAgentChildren,
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
  return Promise.all([local, remote]).then(([census, remoteObserved]) => {
    const mergePtyEvidence = (
      local: UpdateRuntimeCensus['ptys'],
      remoteCount: number,
      reason: 'inventory-partial' | 'agent-owner-inventory-incomplete'
    ) => {
      // Even a valid remote reply only supplies UNKNOWN positive evidence.
      // An older/missing/unreachable runtime also cannot prove its writers
      // idle. Never promote the desktop's known-zero local inventory into a
      // supposedly complete cross-process zero when this profile is checked.
      if (!userDataPath || (local.state === 'unknown' && remoteCount === 0)) {
        return local
      }
      return {
        state: 'unknown' as const,
        reason: remoteCount > 0 ? reason : local.state === 'unknown' ? local.reason : reason,
        lowerBound: Math.max(local.state === 'known' ? local.count : local.lowerBound, remoteCount)
      }
    }
    return {
      ...census,
      ptys: mergePtyEvidence(census.ptys, remoteObserved.ptySessions, 'inventory-partial'),
      ptyOwnedAgentSessions: mergePtyEvidence(
        census.ptyOwnedAgentSessions,
        remoteObserved.ptyOwnedAgentSessions,
        'agent-owner-inventory-incomplete'
      ),
      providerAgentSessions: providerAgentInventory(
        Math.max(census.providerAgentSessions.lowerBound ?? 0, remoteObserved.providerChildren)
      ),
      pendingDiskWrites: pendingWrites(
        Math.max(census.pendingDiskWrites.lowerBound, remoteObserved.pendingWrites)
      )
    }
  })
}
