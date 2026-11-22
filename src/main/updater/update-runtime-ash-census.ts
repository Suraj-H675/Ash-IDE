import { DegradedDaemonPtyProvider } from '../daemon/providers/routing/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../daemon/providers/lifecycle/daemon-provider-routing'
import { getDaemonProvider } from '../daemon/providers/lifecycle/daemon-provider-state'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { UpdateRuntimeCensus } from '../../shared/update-preflight-types'
import { collectUpdateRuntimeCensus } from './update-runtime-census'

/** Bind the read-only census to the actual desktop providers and Store. */
export function collectAshUpdateRuntimeCensus(
  getWindowCount: () => number,
  getLocalPendingWriteActivity: () => boolean
): Promise<UpdateRuntimeCensus> {
  return collectUpdateRuntimeCensus({
    getWindowCount,
    getLocalPendingWriteActivity,
    getLocalProviderAgentSessionCount: () => {
      const host = getStructuredAgentSessionHost()
      // A loaded/resting chat alone is not an executing provider child.
      // This process's host-owned child is positive evidence; missing status
      // never establishes a complete provider-native zero census.
      return (
        host
          ?.loadedSessionIds()
          .filter((id) => host.readStatusSummary(id)?.hostExecutionOwned === true).length ?? 0
      )
    },
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
