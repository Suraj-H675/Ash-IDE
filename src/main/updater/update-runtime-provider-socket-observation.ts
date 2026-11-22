import { z } from 'zod'
import { readRuntimeMetadataAsync } from '../runtime/rpc/server/runtime-metadata'
import { sendOrcadSidecarRequest } from '../orcad/orcad-sidecar-runtime-client'

const PROVIDER_OBSERVATION_TIMEOUT_MS = 2_000
const PROVIDER_OBSERVATION_MAX_BYTES = 8 * 1024
const RuntimeProviderObservation = z.object({
  runtimeId: z.string().min(1).max(128),
  providerAgentSessions: z.object({
    state: z.literal('unknown'),
    reason: z.literal('provider-agent-inventory-unavailable'),
    lowerBound: z.number().int().positive().max(10_000).optional()
  })
})

/**
 * Positive evidence from this profile's separately running authenticated local
 * runtime. A missing/unreachable/replaced runtime never establishes zero idle
 * providers. Do not surface metadata, credentials or session identifiers.
 */
export async function observeLocalRuntimeProviderChildren(userDataPath: string): Promise<number> {
  try {
    const metadata = await readRuntimeMetadataAsync(userDataPath)
    if (!metadata || typeof metadata.runtimeId !== 'string' || !metadata.runtimeId) {
      return 0
    }
    const response = RuntimeProviderObservation.safeParse(
      await sendOrcadSidecarRequest(
        metadata,
        'runtime.providerActivity',
        undefined,
        PROVIDER_OBSERVATION_TIMEOUT_MS,
        { maxResponseBytes: PROVIDER_OBSERVATION_MAX_BYTES, strict: true }
      )
    )
    return response.success && response.data.runtimeId === metadata.runtimeId
      ? (response.data.providerAgentSessions.lowerBound ?? 0)
      : 0
  } catch {
    return 0
  }
}
