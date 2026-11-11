import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PushGatewaySession } from '../push/push-gateway-session'
import { RelayRevokeOutbox } from './relay-revoke-outbox'

const excludedVendorRelayModules = [
  'relay-auth-context.ts',
  'relay-auth-coordinator.ts',
  'relay-auth-identity.ts',
  'relay-assign-rate-gate.ts',
  'relay-control-client-options.ts',
  'relay-control-client.ts',
  'relay-control-liveness.ts',
  'relay-control-origin-options.ts',
  'relay-control-origin.ts',
  'relay-control-protocol.ts',
  'relay-control-requests.ts',
  'relay-control-rotation.ts',
  'relay-control-socket-close.ts',
  'relay-control-url.ts',
  'relay-demand-ledger.ts',
  'relay-host-proof.ts',
  'relay-http-client.ts',
  'relay-linger-timer.ts',
  'relay-origin-pool-options.ts',
  'relay-origin-pool.ts',
  'relay-origin-retirement.ts',
  'relay-pairing-authorization.ts',
  'relay-readiness.ts',
  'relay-region-catalog-fetch.ts',
  'relay-region-correction-protocol.ts',
  'relay-region-decision.ts',
  'relay-region-preference.ts',
  'relay-region-preference-reader.ts',
  'relay-region-probe-log.ts',
  'relay-region-probe.ts',
  'relay-region-refresh.ts',
  'relay-renewal-jitter.ts',
  'relay-retry-schedule.ts',
  'relay-session-broker-contract.ts',
  'relay-session-broker.ts'
] as const

const retainedLegacySupport = [
  'relay-revoke-outbox.ts',
  'simulated-mobile-e2ee-v2-peer.ts'
] as const

describe('Ash excludes orphan vendor relay session and control sources', () => {
  it('does not ship the vendor relay broker, control sockets or regional refresh pipeline', () => {
    const root = resolve(process.cwd(), 'src/main/runtime/mobile-cloud-relay')
    for (const file of excludedVendorRelayModules) {
      expect(existsSync(resolve(root, file)), file).toBe(false)
    }
    expect(readdirSync(root).sort()).toEqual(
      [...retainedLegacySupport, 'ash-retired-vendor-relay-session.test.ts'].sort()
    )
  })

  it('preserves durable historical credential cleanup, including idempotent reload', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'ash-retired-vendor-relay-'))
    const binding = {
      relayHostId: 'previous-service',
      relayDeviceId: 'old-phone',
      ownerIdentityKey: 'previous-user'
    }
    const first = new RelayRevokeOutbox(userDataPath)
    const queued = first.enqueue(binding)
    expect(first.enqueue(binding)).toEqual(queued)
    const reloaded = new RelayRevokeOutbox(userDataPath)
    expect(reloaded.pendingFor(binding.ownerIdentityKey, binding.relayHostId)).toEqual([queued])
  })

  it('excludes the old phone-to-remote-environment adapter but preserves local browser host retirement', () => {
    const root = process.cwd()
    expect(
      existsSync(
        resolve(root, 'src/main/ipc/runtime-environments/runtime-environment-mobile-relay-hosts.ts')
      )
    ).toBe(false)
    const runtimeEnvironments = readFileSync(
      resolve(root, 'src/main/ipc/runtime-environments/runtime-environments.ts'),
      'utf8'
    )
    expect(runtimeEnvironments).not.toContain('retireMobileDesktopRelayEnvironment')
    expect(runtimeEnvironments).toContain('retirePairedRuntimeBrowserClientHostEnvironment(')
    expect(runtimeEnvironments).toContain('closeSubscriptionsForEnvironment(environmentId)')
    expect(runtimeEnvironments).toContain('resetDesktopBrowserBridgeEnvironment(environmentId)')
  })

  it('never clears historical relay region cache during legacy profile sign-out', () => {
    const cloudService = readFileSync(
      resolve(process.cwd(), 'src/main/orca-profiles/profile-cloud-service.ts'),
      'utf8'
    )
    expect(cloudService).not.toContain('clearRelayRegionPreferenceCache')
    expect(cloudService).toContain('signOutCloudSession(active.profile.id, userDataPath)')
  })

  it('keeps the legacy push host fingerprint algorithm without starting a relay service', () => {
    const publicKey = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const session = new PushGatewaySession({
      origin: 'https://example.invalid',
      keypair: {
        publicKey,
        secretKey: new Uint8Array(32),
        publicKeyB64: Buffer.from(publicKey).toString('base64')
      },
      fetchImpl: globalThis.fetch,
      now: () => 0
    })
    expect(session.hostFingerprint).toBe(
      createHash('sha256').update(publicKey).digest('base64url').slice(0, 16)
    )
  })
})
