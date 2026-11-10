import type { ServeReadiness } from '../server/serve-readiness'
import type { OrcaRuntimeRpcServer } from '../runtime/rpc/server/runtime-rpc'
import type { OrcadHealth } from './orcad-health'
import type { OrcadOptions } from './orcad-start-contract'

export async function buildOrcadServeReadiness(input: {
  options: OrcadOptions
  runtimeId: string
  rpc: Pick<OrcaRuntimeRpcServer, 'getWebSocketEndpoint'>
  collectHealth: () => Promise<OrcadHealth>
}): Promise<ServeReadiness> {
  return {
    runtimeId: input.runtimeId,
    // Local runtime readiness must not mint or advertise any client pairing token.
    boundEndpoint: input.rpc.getWebSocketEndpoint(),
    advertisedEndpoint: null,
    pairing: {
      available: false,
      reason: 'disabled_by_product',
      guidance: 'Ash IDE does not support client pairing.'
    },
    // WSL CLI reconciliation runs only in desktop launch, so no repair is pending here.
    managedWslCliReconciliation: 'settled',
    // Deployers inspect readiness health to reject hosts whose terminal daemon is unavailable.
    health: await input.collectHealth()
  }
}
