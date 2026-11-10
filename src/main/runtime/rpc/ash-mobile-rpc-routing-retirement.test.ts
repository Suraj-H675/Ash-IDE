import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { RpcDispatcher } from './dispatcher'
import { denyRpcMethodForCaller, type RpcCallerScope } from './rpc-caller-scope'
import { assertAgentLaunchTargetAuthorized } from './methods/agent-launch-target-authorization'

const phone: RpcCallerScope = { kind: 'mobile' }
const delegatedPhone: RpcCallerScope = { kind: 'mobile', delegated: true }
const browser: RpcCallerScope = { kind: 'runtime-paired', grants: [] }
const owner: RpcCallerScope = { kind: 'owner' }

describe('Ash mobile routing policy retirement', () => {
  it('removes the phone RPC routing and allowlist modules from source', () => {
    for (const path of [
      'src/main/runtime/rpc/server/runtime-rpc-mobile-method-routing.ts',
      'src/main/runtime/rpc/server/runtime-rpc-mobile-method-allowlist.ts',
      'src/main/runtime/rpc/server/runtime-rpc-mobile-agent-session-methods.ts',
      'src/main/runtime/rpc/server/runtime-rpc-mobile-paired-desktop-methods.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
  })

  it.each([
    'status.get',
    'agent.launch',
    'terminal.subscribe',
    'notifications.subscribe',
    'pairing.getEndpoints',
    'notifications.registerPush',
    'unknown.futureMethod'
  ])('denies historical mobile callers without looking up %s', async (method) => {
    const dispatcher = new RpcDispatcher({ runtime: new OrcaRuntimeService() })
    const request = { id: `mobile-${method}`, authToken: 'unused', method, params: {} }
    for (const scope of [phone, delegatedPhone]) {
      expect(denyRpcMethodForCaller(scope, method, undefined)).toBe(
        'Mobile clients are not supported by Ash IDE'
      )
      expect(denyRpcMethodForCaller(scope, method, 'pairing-admin')).toBe(
        'Mobile clients are not supported by Ash IDE'
      )
      const response = await dispatcher.dispatch(request, { callerScope: scope })
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'forbidden', message: 'Mobile clients are not supported by Ash IDE' }
      })
    }
  })

  it('still admits runtime-scoped local browser and owner status requests', async () => {
    const dispatcher = new RpcDispatcher({ runtime: new OrcaRuntimeService() })
    const request = { id: 'local-status', authToken: 'unused', method: 'status.get', params: {} }
    for (const callerScope of [browser, owner]) {
      expect(await dispatcher.dispatch(request, { callerScope })).toMatchObject({
        ok: true
      })
    }
    expect(
      await dispatcher.dispatch(
        { ...request, method: 'unknown.futureMethod' },
        { callerScope: browser }
      )
    ).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
  })

  it('denies a mobile streaming subscription before opening any stream', async () => {
    const dispatcher = new RpcDispatcher({ runtime: new OrcaRuntimeService() })
    for (const callerScope of [phone, delegatedPhone]) {
      const replies: Record<string, unknown>[] = []
      await dispatcher.dispatchStreaming(
        {
          id: 'mobile-status-stream',
          authToken: 'unused',
          method: 'notifications.subscribe',
          params: {}
        },
        (reply) => replies.push(JSON.parse(reply) as Record<string, unknown>),
        { callerScope }
      )
      expect(replies).toEqual([
        expect.objectContaining({
          id: 'mobile-status-stream',
          ok: false,
          error: expect.objectContaining({
            code: 'forbidden',
            message: 'Mobile clients are not supported by Ash IDE'
          })
        })
      ])
    }
  })

  it('preserves the direct handler folder-create rule while RPC admission rejects every phone method', () => {
    for (const kind of ['existing', 'create-worktree', 'create-folder-workspace'] as const) {
      const attempt = () => assertAgentLaunchTargetAuthorized({ kind }, { clientKind: 'mobile' })
      if (kind === 'create-folder-workspace') {
        expect(attempt).toThrow('agent_launch_target_forbidden')
      } else {
        expect(attempt).not.toThrow()
      }
      expect(() =>
        assertAgentLaunchTargetAuthorized({ kind }, { clientKind: 'runtime' })
      ).not.toThrow()
      expect(() => assertAgentLaunchTargetAuthorized({ kind }, {})).not.toThrow()
    }
  })
})
