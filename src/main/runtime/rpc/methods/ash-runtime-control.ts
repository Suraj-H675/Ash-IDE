import { z } from 'zod'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { defineMethod } from '../core'

export const ASH_RUNTIME_CONTROL_METHODS = [
  defineMethod({
    name: 'runtime.stop',
    permission: 'host-admin',
    params: z.object({
      confirmed: z.literal(true),
      expectedRuntimeId: z.string().min(1).max(128),
      mode: z.enum(['graceful', 'force'])
    }),
    handler: async ({ expectedRuntimeId, mode }, { runtime }) => {
      const runtimeId = runtime.getRuntimeId()
      if (runtimeId !== expectedRuntimeId) {
        return { status: 'replaced' as const }
      }
      const accepted = getAppEnvironment().requestRuntimeStop?.(mode)
      if (!accepted) {
        throw new Error('runtime_stop_host_unavailable')
      }
      return { status: 'stopping' as const, mode, runtimeId }
    }
  })
]
