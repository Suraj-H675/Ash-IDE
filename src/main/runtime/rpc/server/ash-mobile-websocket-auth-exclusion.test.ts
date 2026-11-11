import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair
} from '../../../../shared/remote-runtime/e2ee/node/e2ee-crypto'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import {
  authenticateMobileWsSession,
  connectWs,
  createEncryptedWsResponseReader,
  nextWsMessage,
  sendEncryptedWsRequest,
  waitForWsClose
} from './runtime-rpc-mobile-ws-test-harness'

describe('Ash local-only WebSocket device authentication', () => {
  it('refuses a real mobile-scoped credential but retains authenticated local browser RPC', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'ash-local-ws-auth-'))
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0,
      pinnedBindHost: '127.0.0.1'
    })
    await server.start()
    try {
      // Legacy registry rows may predate Ash. Inject one without exposing a
      // mobile pairing API or minting a fresh phone credential.
      const mobile = server.getDeviceRegistry()?.addDevice('historical phone', 'mobile')
      const endpoint = server.getWebSocketEndpoint()
      const publicKeyB64 = server.getE2EEPublicKey()
      if (!mobile || !endpoint || !publicKeyB64) {
        throw new Error('Historical credential fixture unavailable')
      }
      const ws = await connectWs(endpoint)
      try {
        const phoneKeypair = generateKeyPair()
        const sharedKey = deriveSharedKey(
          phoneKeypair.secretKey,
          Uint8Array.from(Buffer.from(publicKeyB64, 'base64'))
        )
        ws.send(
          JSON.stringify({
            type: 'e2ee_hello',
            publicKeyB64: Buffer.from(phoneKeypair.publicKey).toString('base64')
          })
        )
        expect(JSON.parse(await nextWsMessage(ws))).toEqual({ type: 'e2ee_ready' })
        const rejection = nextWsMessage(ws)
        const closed = waitForWsClose(ws)
        ws.send(
          encrypt(JSON.stringify({ type: 'e2ee_auth', deviceToken: mobile.token }), sharedKey)
        )
        expect(JSON.parse(decrypt(await rejection, sharedKey)!)).toEqual({
          type: 'e2ee_error',
          error: { code: 'unauthorized' }
        })
        await closed
        expect(server['mobileSocketWiring']?.channelCount).toBe(0)
        expect(server.getDeviceRegistry()?.getDevice(mobile.deviceId)?.scope).toBe('mobile')
      } finally {
        ws.terminate()
      }

      const localBrowser = server.createPairingOffer({
        address: '127.0.0.1',
        name: 'local browser',
        scope: 'runtime'
      })
      expect(localBrowser.available).toBe(true)
      if (!localBrowser.available) {
        throw new Error('Test-only local browser credential could not be constructed')
      }
      const session = await authenticateMobileWsSession(localBrowser.pairingUrl)
      const reader = createEncryptedWsResponseReader(session)
      try {
        sendEncryptedWsRequest(session, { id: 'local-status', method: 'status.get' })
        expect(await reader.next('local-status')).toMatchObject({
          id: 'local-status',
          ok: true
        })
        expect(server.getDeviceRegistry()?.getDevice(localBrowser.deviceId)?.scope).toBe('runtime')
      } finally {
        reader.dispose()
        session.ws.close()
      }
    } finally {
      await server.stop()
    }
  }, 30_000)
})
