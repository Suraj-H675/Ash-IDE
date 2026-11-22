import { observedHostedStructuredAgentChildren } from '../../../native-chat/agent-session-wire/structured-agent-session-positive-evidence'
import { defineMethod } from '../core'

/** Host-local observation over the authenticated runtime socket, never update admission. */
export const ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS = [
  defineMethod({
    name: 'runtime.providerActivity',
    permission: 'host-admin',
    params: null,
    handler: async (_params, { runtime, clientKind, pairedDeviceId }) => {
      // No remote/pairing inventory surface. Only the local authenticated
      // runtime socket used by the desktop/CLI may read this host snapshot.
      if (clientKind || pairedDeviceId) {
        throw new Error('runtime_provider_activity_local_only')
      }
      let lowerBound = 0
      try {
        lowerBound = observedHostedStructuredAgentChildren()
      } catch {
        // A broken local status feed cannot prove absence. Report unknown.
      }
      const observedStoreWrite = (): number => {
        try {
          return runtime.hasObservedPendingLocalProfileWrite() ? 1 : 0
        } catch {
          // A failed Store observation is not proof that the write worker is idle.
          return 0
        }
      }
      const pendingWriteAtStart = observedStoreWrite()
      // Bound even a stalled authenticated daemon; a failed read contributes
      // no positive count, never a verified zero inventory.
      let ptyEvidence = { ptySessions: 0, ptyOwnedAgentSessions: 0 }
      try {
        const { observeConnectedPtyPositiveEvidence } =
          await import('../../../updater/update-runtime-connected-pty-evidence')
        ptyEvidence = await observeConnectedPtyPositiveEvidence()
      } catch {
        // Do not suppress independent positive provider/Store observations if
        // the daemon inventory module or one of its providers fails.
      }
      // A write admitted while the daemon inventory awaited a response must
      // not disappear behind an apparently quiet initial Store sample.
      const pendingWriteLowerBound = Math.max(pendingWriteAtStart, observedStoreWrite())
      return {
        runtimeId: runtime.getRuntimeId(),
        providerAgentSessions: {
          state: 'unknown' as const,
          reason: 'provider-agent-inventory-unavailable' as const,
          ...(lowerBound > 0 ? { lowerBound: Math.min(lowerBound, 10_000) } : {})
        },
        pendingDiskWrites: {
          state: 'unknown' as const,
          reason: 'pending-write-census-unavailable' as const,
          lowerBound: pendingWriteLowerBound
        },
        ptys: {
          state: 'unknown' as const,
          reason: 'inventory-partial' as const,
          lowerBound: ptyEvidence.ptySessions
        },
        ptyOwnedAgentSessions: {
          state: 'unknown' as const,
          reason: 'agent-owner-inventory-incomplete' as const,
          lowerBound: ptyEvidence.ptyOwnedAgentSessions
        }
      }
    }
  })
]
