import { describe, expect, it } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PREFLIGHT_METHODS } from './preflight'
import { ASH_RPC_METHODS } from './index'
import { RPC_PARAMS_BY_METHOD } from '../../../../shared/rpc-contract/rpc-params-catalog.generated'

const retired = [
  'preflight.detectRemoteAgents',
  'preflight.detectRemoteWindowsTerminalCapabilities'
] as const

describe('Ash authenticated runtime preflight does not manage SSH hosts', () => {
  it('omits remote methods even from the broad RPC registry and generated client contract', () => {
    const all = new Set<string>(PREFLIGHT_METHODS.map(({ name }) => name))
    const ash = new Set<string>(ASH_RPC_METHODS.map(({ name }) => name))
    for (const method of retired) {
      expect(all.has(method), `${method} must not be compiled into the runtime`).toBe(false)
      expect(ash.has(method), `${method} must not be exposed to callers`).toBe(false)
      expect(Object.hasOwn(RPC_PARAMS_BY_METHOD, method), `${method} must not be generated`).toBe(
        false
      )
    }
    expect(ash.has('preflight.detectAgents')).toBe(true)
    expect(ash.has('preflight.refreshAgents')).toBe(true)
  })

  it('rejects retired calls without consulting the local or remote agent inventory', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime',
      resolveAgentDetectionHost: () => {
        throw new Error('must not inspect host')
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ASH_RPC_METHODS })
    for (const method of retired) {
      const response = await dispatcher.dispatch({
        id: method,
        authToken: 'token',
        method,
        params: { connectionId: 'old-ssh-host' }
      })
      expect(response).toMatchObject({ ok: false })
    }
  })
})
