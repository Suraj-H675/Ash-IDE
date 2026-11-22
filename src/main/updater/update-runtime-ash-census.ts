import { DegradedDaemonPtyProvider } from '../daemon/providers/routing/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../daemon/providers/lifecycle/daemon-provider-routing'
import { getDaemonProvider } from '../daemon/providers/lifecycle/daemon-provider-state'
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
