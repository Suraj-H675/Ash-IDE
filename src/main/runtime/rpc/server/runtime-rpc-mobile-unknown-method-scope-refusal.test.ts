import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './pairing/device-registry'
import { createMobileRpcSurfaceRuntime } from './runtime-rpc-mobile-method-allowlist-fixtures'
import { AGENT_SESSION_AGENTS_METHOD } from '../../../../shared/agent-session/agent-session-registered-agents'

/** Ash refuses saved mobile-scoped credentials before method routing and dispatch. */
function errorCode(reply: Record<string, unknown>): string | undefined {
  const error = reply.error
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return typeof error.code === 'string' ? error.code : undefined
}

describe('excluded mobile-scoped RPC admission', () => {
  const dispatchAs = async (
    scope: 'mobile' | 'runtime',
    method: string
  ): Promise<Record<string, unknown>> => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-scope-'))
    const { runtime } = createMobileRpcSurfaceRuntime()
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    server['deviceRegistry'] = new DeviceRegistry(userDataPath)
    const device = server['deviceRegistry']!.addDevice('peer', scope)
    const replies: Record<string, unknown>[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'req_1', method, deviceToken: device.token, params: {} }),
      (response) => {
        const parsed: Record<string, unknown> = JSON.parse(response)
        replies.push(parsed)
      },
      () => {}
    )
    return replies[0] ?? {}
  }

  it('answers unauthorized, not a method-existence oracle, for an unknown mobile request', async () => {
    const reply = await dispatchAs('mobile', 'pairing.methodThisBuildHasNeverHeardOf')
    expect(reply.ok).toBe(false)
    expect(errorCode(reply)).toBe('unauthorized')
    expect(errorCode(reply)).not.toBe('method_not_found')
  })

  it('refuses the formerly allowed agent catalog to historical phone credentials', async () => {
    expect(errorCode(await dispatchAs('mobile', AGENT_SESSION_AGENTS_METHOD))).toBe('unauthorized')
  })

  it('answers method_not_found to a non-mobile peer for the same unknown method', async () => {
    const reply = await dispatchAs('runtime', 'pairing.methodThisBuildHasNeverHeardOf')
    expect(reply.ok).toBe(false)
    expect(errorCode(reply)).toBe('method_not_found')
  })

  it('refuses the excluded mobile pairing and relay probes', async () => {
    for (const method of ['pairing.getEndpoints', 'pairing.provisionRelay']) {
      expect(errorCode(await dispatchAs('mobile', method)), method).toBe('unauthorized')
    }
  })
})
