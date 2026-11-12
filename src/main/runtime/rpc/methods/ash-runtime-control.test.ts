import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcContext } from '../core'
import { ASH_RUNTIME_CONTROL_METHODS } from './ash-runtime-control'

const requestRuntimeStop = vi.hoisted(() => vi.fn<(_mode: 'graceful' | 'force') => boolean>())

vi.mock('../../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ requestRuntimeStop })
}))

const method = ASH_RUNTIME_CONTROL_METHODS[0]!
const runtime = {
  getRuntimeId: () => 'runtime-current'
} as unknown as OrcaRuntimeService
const context = { runtime } as RpcContext

beforeEach(() => {
  requestRuntimeStop.mockReset()
  requestRuntimeStop.mockReturnValue(true)
})

describe('Ash authenticated runtime stop', () => {
  it('never stops a replacement runtime when the expected runtime ID is stale', async () => {
    const result = await method.handler(
      { confirmed: true, expectedRuntimeId: 'runtime-previous', mode: 'force' },
      context
    )
    expect(result).toEqual({ status: 'replaced' })
    expect(requestRuntimeStop).not.toHaveBeenCalled()
  })

  it.each(['graceful', 'force'] as const)('schedules %s through the owning host', async (mode) => {
    const result = await method.handler(
      { confirmed: true, expectedRuntimeId: 'runtime-current', mode },
      context
    )
    expect(requestRuntimeStop).toHaveBeenCalledExactlyOnceWith(mode)
    expect(result).toEqual({ status: 'stopping', mode, runtimeId: 'runtime-current' })
  })

  it('refuses to claim a stop when the host has no shutdown admission', async () => {
    requestRuntimeStop.mockReturnValue(false)
    await expect(
      method.handler(
        { confirmed: true, expectedRuntimeId: 'runtime-current', mode: 'graceful' },
        context
      )
    ).rejects.toThrow('runtime_stop_host_unavailable')
  })
})
