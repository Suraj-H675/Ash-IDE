import type { RuntimeDeviceGrant } from '../rpc-method-permission'
import type { DeviceRegistry } from './pairing/device-registry'
import type { DeviceScope } from '../../../../shared/runtime-session-contracts'
import type { TokenDeviceEntry } from './pairing/device-entry'
import type { E2EEKeypair } from '../../e2ee-keypair'
import type { MobileSocketWiring } from '../mobile-socket-wiring'
import type { RelayRevokeOutbox } from '../../mobile-cloud-relay/relay-revoke-outbox'
import type { PushUnregisterOutbox } from '../../push/push-unregister-outbox'
import { encodePairingOffer } from '../../../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { RuntimePairingReach } from '../../../../shared/runtime-pairing-reach'
import { resolveAdvertisedPairingEndpoint } from '../../pairing-endpoint'
import { RuntimeRpcNetworkExposure } from './runtime-rpc-network-exposure'
import {
  createWebClientUrl,
  DEVICE_REGISTRY_UNAVAILABLE_GUIDANCE,
  E2EE_KEY_UNAVAILABLE_GUIDANCE,
  pairingUnavailable,
  type PairingOfferUnavailable
} from './runtime-rpc-pairing-types'

export class RuntimeRpcPairing extends RuntimeRpcNetworkExposure {
  getDeviceRegistry(): DeviceRegistry | null {
    return this.deviceRegistry
  }

  getE2EEPublicKey(): string | null {
    return this.e2eeKeypair?.publicKeyB64 ?? null
  }

  getE2EEKeypair(): E2EEKeypair | null {
    return this.e2eeKeypair
  }

  getMobileSocketWiring(): MobileSocketWiring | null {
    return this.mobileSocketWiring
  }

  getRelayRevokeOutbox(): RelayRevokeOutbox {
    return this.relayRevokeOutbox
  }

  getPushUnregisterOutbox(): PushUnregisterOutbox {
    return this.pushUnregisterOutbox
  }

  // Why: only the desktop shell can surface UI; headless serve leaves this unset.
  setOnUnpairedDeviceAuthFailure(callback: (() => void) | null): void {
    this.onUnpairedDeviceAuthFailure = callback
  }

  getWebSocketEndpoint(): string | null {
    const ws = this.transports.find((t) => t.kind === 'websocket')
    return ws?.endpoint ?? null
  }

  createPairingOffer(args: {
    address?: string | null
    name?: string
    rotate?: boolean
    scope?: DeviceScope
    // Persist local-only policy on grants so reconnect cannot expose every interface; other callers default to network reach (STA-2370).
    reach?: RuntimePairingReach
    // Grant administrative permissions only at pairing, never as later device upgrades.
    grants?: readonly RuntimeDeviceGrant[]
  }):
    | PairingOfferUnavailable
    | {
        available: true
        pairingUrl: string
        endpoint: string
        deviceId: string
        webClientUrl: string | null
      } {
    // Fail closed before generating or rotating credentials. Historical phone
    // rows remain on disk for non-destructive revocation, but Ash never mints
    // a new mobile-scoped pairing offer, even via an internal call.
    if (args.scope === 'mobile') {
      return pairingUnavailable(
        'mobile_pairing_disabled',
        'Ash IDE does not support mobile pairing.'
      )
    }
    if (this.pairingInitializationFailure) {
      return this.pairingInitializationFailure
    }
    const rawEndpoint = this.getWebSocketEndpoint()
    if (!rawEndpoint) {
      return pairingUnavailable(
        'websocket_unavailable',
        'WebSocket pairing is unavailable. Inspect preceding runtime errors and choose an unused --port if the listener failed.'
      )
    }
    if (!this.deviceRegistry) {
      return pairingUnavailable('device_registry_unavailable', DEVICE_REGISTRY_UNAVAILABLE_GUIDANCE)
    }
    const publicKeyB64 = this.getE2EEPublicKey()
    if (!publicKeyB64) {
      return pairingUnavailable('e2ee_key_unavailable', E2EE_KEY_UNAVAILABLE_GUIDANCE)
    }

    const advertised = resolveAdvertisedPairingEndpoint(rawEndpoint, args.address)
    if (!advertised.ok) {
      return pairingUnavailable(advertised.reason, advertised.guidance)
    }
    const endpoint = advertised.endpoint
    const deviceName = args.name ?? `CLI ${new Date().toLocaleDateString()}`
    const scope = args.scope ?? 'runtime'
    let device: TokenDeviceEntry
    try {
      const reach = args.reach ?? 'network'
      const grants = args.grants ?? []
      device = args.rotate
        ? this.deviceRegistry.rotatePendingDevice(deviceName, scope, reach, grants)
        : this.deviceRegistry.getOrCreatePendingDevice(deviceName, scope, reach, grants)
    } catch (error) {
      console.error('[runtime] Failed to persist pairing credential:', error)
      return pairingUnavailable('device_registry_unavailable', DEVICE_REGISTRY_UNAVAILABLE_GUIDANCE)
    }
    const hostDescriptor = this.hostDescriptor
    const pairingUrl = encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      endpoint,
      deviceToken: device.token,
      publicKeyB64,
      pairedDeviceId: device.deviceId,
      scope,
      // Runtime clients pin host identity; mobile does not need these extra QR bytes.
      ...(hostDescriptor && scope === 'runtime' ? { hostDescriptor } : {})
    })
    return {
      available: true,
      pairingUrl,
      endpoint,
      deviceId: device.deviceId,
      webClientUrl:
        this.webClientRoot && scope === 'runtime' ? createWebClientUrl(endpoint, pairingUrl) : null
    }
  }
}
