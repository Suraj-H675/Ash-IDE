import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { DeviceRegistry } from './pairing/device-registry'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'

describe('Ash excludes mobile pairing and preserves local browser credentials', () => {
  it('does not ship the legacy mobile IPC, preload bridge, relay offer class or relay-mint tests', () => {
    for (const file of [
      'src/main/ipc/mobile.ts',
      'src/preload/api/mobile-bridge.ts',
      'src/main/runtime/rpc/server/runtime-rpc-mobile-pairing.ts',
      'src/main/runtime/rpc/server/runtime-rpc-relay-pairing.test.ts',
      'src/main/runtime/rpc/server/runtime-rpc-relay-provider-install.test.ts',
      'src/main/runtime/rpc/server/runtime-rpc-pairing-mode-persistence.test.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
    }
  })

  it('has no mobile-offer method or on-demand relay-mint installer on the runtime server', () => {
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'ash-no-mobile-apis-'))
    })
    expect('createMobilePairingOffer' in server).toBe(false)
    expect('setMobileRelayPairingProviderInstaller' in server).toBe(false)
  })

  it('refuses mobile-scoped minting without touching historical registry entries', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'ash-no-mobile-credential-'))
    const historical = new DeviceRegistry(userDataPath).addDevice('Existing phone', 'mobile')
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0,
      pinnedBindHost: '127.0.0.1'
    })
    await server.start()
    try {
      const previous = server.getDeviceRegistry()?.getDevice(historical.deviceId)
      expect(previous?.token).toBe(historical.token)
      expect(server.getWebSocketEndpoint()).toContain('127.0.0.1')
      expect(
        server.createPairingOffer({
          name: 'Should never be minted',
          address: '100.64.1.20',
          scope: 'mobile',
          rotate: true
        })
      ).toMatchObject({
        available: false,
        reason: 'mobile_pairing_disabled'
      })
      expect(server.getDeviceRegistry()?.listDevices()).toHaveLength(1)
      expect(server.getDeviceRegistry()?.getDevice(historical.deviceId)).toEqual(previous)

      const browserOffer = server.createPairingOffer({
        name: 'Local browser',
        address: '127.0.0.1',
        scope: 'runtime',
        reach: 'this-computer'
      })
      expect(browserOffer.available).toBe(true)
      if (!browserOffer.available) throw new Error('Local browser pairing unavailable')
      expect(parsePairingCode(browserOffer.pairingUrl)?.scope).toBe('runtime')
      expect(server.getDeviceRegistry()?.getDevice(browserOffer.deviceId)?.scope).toBe('runtime')
      expect(server.getWebSocketEndpoint()).toContain('127.0.0.1')
      expect(server.getDeviceRegistry()?.getDevice(historical.deviceId)).toEqual(previous)
    } finally {
      await server.stop()
    }
  })
})
