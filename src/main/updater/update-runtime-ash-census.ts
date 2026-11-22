import { DegradedDaemonPtyProvider } from '../daemon/providers/routing/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../daemon/providers/lifecycle/daemon-provider-routing'
import { getDaemonProvider } from '../daemon/providers/lifecycle/daemon-provider-state'
import { observedHostedStructuredAgentChildren } from '../native-chat/agent-session-wire/structured-agent-session-positive-evidence'
import type { UpdateRuntimeCensus } from '../../shared/update-preflight-types'
import { collectUpdateRuntimeCensus } from './update-runtime-census'
import { observeLocalRuntimeProviderChildren } from './update-runtime-provider-socket-observation'
import { providerAgentInventory } from './update-runtime-census-evidence'

/** Bind the read-only census to the actual desktop providers and Store. */
export function collectAshUpdateRuntimeCensus(
  getWindowCount: () => number,
  getLocalPendingWriteActivity: () => boolean,
  userDataPath?: string
): Promise<UpdateRuntimeCensus> {
  // No runtime is launched by this diagnostic. A missing or denied socket
  // reports zero positive evidence but never a verified idle inventory.
  const remote = userDataPath
    ? observeLocalRuntimeProviderChildren(userDataPath)
    : Promise.resolve(0)
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
  return Promise.all([local, remote]).then(([census, remoteObserved]) => ({
    ...census,
    providerAgentSessions: providerAgentInventory(
      Math.max(census.providerAgentSessions.lowerBound ?? 0, remoteObserved)
    )
  }))
}
