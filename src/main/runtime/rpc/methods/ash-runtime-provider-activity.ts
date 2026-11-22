import { observedHostedStructuredAgentChildren } from '../../../native-chat/agent-session-wire/structured-agent-session-positive-evidence'
import { defineMethod } from '../core'

/** Host-local observation over the authenticated runtime socket, never update admission. */
export const ASH_RUNTIME_PROVIDER_ACTIVITY_METHODS = [
  defineMethod({
    name: 'runtime.providerActivity',
    permission: 'host-admin',
    params: null,
    handler: (_params, { runtime, clientKind, pairedDeviceId }) => {
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
      return {
        runtimeId: runtime.getRuntimeId(),
        providerAgentSessions: {
          state: 'unknown' as const,
          reason: 'provider-agent-inventory-unavailable' as const,
          ...(lowerBound > 0 ? { lowerBound: Math.min(lowerBound, 10_000) } : {})
        }
      }
    }
  })
]
