import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RelayRevokeOutbox } from '../../mobile-cloud-relay/relay-revoke-outbox'
import { DeviceRegistry } from './pairing/device-registry'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

const removedHooks = [
  'setMobileRelayPairingProvider',
  'setMobileDesktopRelayHosts',
  'setMobileRelayBinding',
  'mobileRelayPairingProvider',
  'mobileDesktopRelay',
  'mobileRelayHostCatalog',
  'detachPairedServerRows'
] as const

function legacyDeviceFixture() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ash-retired-relay-hook-'))
  const registry = new DeviceRegistry(userDataPath)
  const mobile = registry.addDevice('Historical phone', 'mobile')
  const binding = {
    relayHostId: 'historical-relay-host',
    relayDeviceId: mobile.deviceId,
    ownerIdentityKey: 'historical-owner'
  }
  expect(registry.setRelayBinding(mobile.deviceId, binding)).toBe(true)
  const server = new OrcaRuntimeRpcServer({
    runtime: new OrcaRuntimeService(),
    userDataPath,
    enableWebSocket: true,
    wsPort: 0,
    pinnedBindHost: '127.0.0.1'
  })
  return { userDataPath, server, mobile, binding }
}

describe('Ash retires mobile relay registration but retains historical credential cleanup', () => {
  it('does not expose mobile relay provider, host catalog, or binding setters', () => {
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'ash-no-relay-provider-'))
    })
    for (const hook of removedHooks) {
      expect(hook in server, hook).toBe(false)
    }
    expect(typeof server.revokeMobileDevice).toBe('function')
    expect(typeof server.revokeRuntimeAccess).toBe('function')
  })

  it('durably records relay revocation before deleting a historical phone row', async () => {
    const { userDataPath, server, mobile, binding } = legacyDeviceFixture()
    await server.start()
    try {
      expect(server.getDeviceRegistry()?.getDevice(mobile.deviceId)?.relayBinding).toEqual(binding)
      expect(await server.revokeMobileDevice(mobile.deviceId)).toBe(true)
      expect(server.getDeviceRegistry()?.getDevice(mobile.deviceId)).toBeNull()
      const queued = server
        .getRelayRevokeOutbox()
        .pendingFor(binding.ownerIdentityKey, binding.relayHostId)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject(binding)
      // The cleanup record survives a fresh load independently of live provider callbacks.
      expect(
        new RelayRevokeOutbox(userDataPath).pendingFor(
          binding.ownerIdentityKey,
          binding.relayHostId
        )
      ).toEqual(queued)
    } finally {
      await server.stop()
    }
  })

  it('does not delete a historical phone if durable relay cleanup cannot be queued', async () => {
    const { server, mobile, binding } = legacyDeviceFixture()
    await server.start()
    const enqueue = vi.spyOn(server.getRelayRevokeOutbox(), 'enqueue').mockImplementation(() => {
      throw new Error('test-only write failure')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await server.revokeMobileDevice(mobile.deviceId)).toBe(false)
      expect(enqueue).toHaveBeenCalledWith(binding)
      expect(server.getDeviceRegistry()?.getDevice(mobile.deviceId)?.relayBinding).toEqual(binding)
    } finally {
      enqueue.mockRestore()
      log.mockRestore()
      await server.stop()
    }
  })

  it('keeps runtime-scoped access revocation distinct from historical phone revocation', async () => {
    const { server, mobile, binding } = legacyDeviceFixture()
    await server.start()
    try {
      const browser = server
        .getDeviceRegistry()
        ?.addDevice('Local browser', 'runtime', 'this-computer')
      expect(browser).toBeDefined()
      if (!browser) throw new Error('Missing local browser test device')
      expect(server.revokeRuntimeAccess(browser.deviceId)).toBe(true)
      expect(server.getDeviceRegistry()?.getDevice(browser.deviceId)).toBeNull()
      expect(server.getDeviceRegistry()?.getDevice(mobile.deviceId)?.relayBinding).toEqual(binding)
      expect(
        server.getRelayRevokeOutbox().pendingFor(binding.ownerIdentityKey, binding.relayHostId)
      ).toEqual([])
    } finally {
      await server.stop()
    }
  })
})
