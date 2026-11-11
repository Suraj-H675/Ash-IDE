import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { DeviceRegistry } from './pairing/device-registry'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

function localRpcFixture() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ash-excluded-mobile-rpc-'))
  const runtime = new OrcaRuntimeService()
  const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
  const registry = new DeviceRegistry(userDataPath)
  server['deviceRegistry'] = registry
  const phone = registry.addDevice('Historical phone', 'mobile')
  const browser = registry.addDevice('Local browser', 'runtime')
  const dispatch = async (
    deviceToken: string,
    method: string,
    executionHost?: string
  ): Promise<Record<string, unknown>> => {
    const replies: Record<string, unknown>[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'admission', method, deviceToken, executionHost, params: {} }),
      (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
      () => {}
    )
    return replies[0] ?? {}
  }
  return { server, registry, phone, browser, dispatch }
}

describe('Ash no-mobile RPC admission after relay forwarding removal', () => {
  it('refuses every historical phone request before method existence or remote routing', async () => {
    const { server, registry, phone, dispatch } = localRpcFixture()
    const dispatcher = vi.spyOn(server['dispatcher'], 'dispatchStreaming')
    for (const method of [
      'status.get',
      'agentSession.agents',
      'terminal.subscribe',
      'browser.goto',
      'pairing.provisionRelay',
      'pairing.getEndpoints',
      'files.delete',
      'unknown.futureMethod'
    ]) {
      const reply = await dispatch(phone.token, method, 'host:foreign-machine')
      expect(reply, method).toMatchObject({
        ok: false,
        error: { code: 'unauthorized' }
      })
    }
    expect(dispatcher).not.toHaveBeenCalled()
    expect(registry.getDevice(phone.deviceId)?.scope).toBe('mobile')
  })

  it('retains local browser RPC even when untrusted request fields mention a remote host', async () => {
    const { server, browser, dispatch } = localRpcFixture()
    expect('mobileDesktopRelay' in server).toBe(false)
    expect('setMobileDesktopRelayHosts' in server).toBe(false)
    expect(await dispatch(browser.token, 'status.get', 'host:foreign-machine')).toMatchObject({
      ok: true
    })
  })

  it('keeps a revoked local browser credential unauthorized', async () => {
    const { registry, browser, dispatch } = localRpcFixture()
    expect(await dispatch(browser.token, 'status.get')).toMatchObject({ ok: true })
    expect(registry.removeDevice(browser.deviceId)).toBe(true)
    expect(await dispatch(browser.token, 'status.get')).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('does not retain a phone forwarding or relay-admission branch in the live dispatcher', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/main/runtime/rpc/server/runtime-rpc-websocket-dispatch.ts'),
      'utf8'
    )
    expect(source).not.toContain('relayMobileRequest(')
    expect(source).not.toContain('MOBILE_RPC_METHOD_ROUTES')
    expect(source).not.toContain('MOBILE_RPC_METHOD_ALLOWLIST')
    expect(source).not.toContain('mobileDesktopRelay?.forwardClientCapabilities(')
    expect(source).not.toContain('mobileDesktopRelay.forward(')
  })
})
