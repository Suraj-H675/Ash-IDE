import { z } from 'zod'
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
      const { app } = await import('electron')
      setImmediate(() => {
        if (mode === 'force') {
          app.exit(0)
        } else {
          app.quit()
        }
      })
      return { status: 'stopping' as const, mode, runtimeId }
    }
  })
]
