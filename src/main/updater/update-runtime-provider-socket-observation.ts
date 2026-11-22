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
  }),
  /** An older host cannot establish browser-backend absence. */
  browserBackends: z
    .object({
      state: z.literal('unknown'),
      reason: z.literal('browser-backend-inventory-unavailable'),
      lowerBound: z.union([z.literal(0), z.literal(1)])
    })
    .optional(),
  /** Older local runtimes legitimately omit this field. Absence is unknown. */
  pendingDiskWrites: z
    .object({
      state: z.literal('unknown'),
      reason: z.literal('pending-write-census-unavailable'),
      lowerBound: z.union([z.literal(0), z.literal(1)])
    })
    .optional(),
  ptys: z
    .object({
      state: z.literal('unknown'),
      reason: z.literal('inventory-partial'),
      lowerBound: z.number().int().min(0).max(10_000)
    })
    .optional(),
  ptyOwnedAgentSessions: z
    .object({
      state: z.literal('unknown'),
      reason: z.literal('agent-owner-inventory-incomplete'),
      lowerBound: z.number().int().min(0).max(10_000)
    })
    .optional()
})

export type LocalRuntimeWriterObservation = {
  providerChildren: number
  pendingWrites: 0 | 1
  ptySessions: number
  ptyOwnedAgentSessions: number
  browserBackend: 0 | 1
}

const NOTHING_OBSERVED: LocalRuntimeWriterObservation = Object.freeze({
  providerChildren: 0,
  pendingWrites: 0,
  ptySessions: 0,
  ptyOwnedAgentSessions: 0,
  browserBackend: 0
})

/**
 * Positive provider, connected PTY and Store writer evidence from this profile's
 * separately running authenticated local runtime. Missing/unreachable/replaced
 * runtimes never establish zero active writers or authorize update activation.
 * Do not surface metadata, credentials, paths or session identifiers.
 */
export async function observeLocalRuntimeWriterActivity(
  userDataPath: string
): Promise<LocalRuntimeWriterObservation> {
  try {
    const metadata = await readRuntimeMetadataAsync(userDataPath)
    if (!metadata || typeof metadata.runtimeId !== 'string' || !metadata.runtimeId) {
      return NOTHING_OBSERVED
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
      ? {
          providerChildren: response.data.providerAgentSessions.lowerBound ?? 0,
          pendingWrites: response.data.pendingDiskWrites?.lowerBound ?? 0,
          ptySessions: response.data.ptys?.lowerBound ?? 0,
          ptyOwnedAgentSessions: response.data.ptyOwnedAgentSessions?.lowerBound ?? 0,
          browserBackend: response.data.browserBackends?.lowerBound ?? 0
        }
      : NOTHING_OBSERVED
  } catch {
    return NOTHING_OBSERVED
  }
}

/** Retained for consumers that need only provider-child evidence. */
export async function observeLocalRuntimeProviderChildren(userDataPath: string): Promise<number> {
  return (await observeLocalRuntimeWriterActivity(userDataPath)).providerChildren
}
