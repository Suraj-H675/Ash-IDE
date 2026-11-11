import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { RuntimeMobileNotificationController } from './notifications/runtime-mobile-notification-controller'
import { PushUnregisterOutbox } from './push-unregister-outbox'

const removedGatewaySources = [
  'desktop-push-service.ts',
  'push-dispatcher.test-fixture.ts',
  'push-dispatcher.ts',
  'push-gateway-client.ts',
  'push-gateway-origin.ts',
  'push-gateway-response.ts',
  'push-gateway-session.ts',
  'push-host-challenge-fixtures.ts',
  'push-host-proof-vector.json',
  'push-host-proof-vector.test.ts',
  'push-host-proof.ts',
  'push-outcome-counters.ts',
  'push-register-throttle.ts'
] as const

describe('Ash excludes the vendor mobile push gateway, keeping desktop notifications', () => {
  it('does not ship the mobile gateway service, credentials, dispatcher or proof fixtures', () => {
    const root = resolve(process.cwd(), 'src/main/runtime/push')
    for (const file of removedGatewaySources) {
      expect(existsSync(resolve(root, file)), file).toBe(false)
    }
    expect(readdirSync(root).sort()).toEqual(
      [
        'ash-mobile-push-gateway-retirement.test.ts',
        'notifications',
        'push-unregister-outbox.ts'
      ].sort()
    )
    const config = readFileSync(
      resolve(process.cwd(), 'src/main/orca-profiles/profile-cloud-auth-config.ts'),
      'utf8'
    )
    expect(config).not.toContain('getOrcaPushGatewayUrl')
    expect(config).not.toContain('resolvePushGatewayOrigin')
  })

  it('removes mobile registration methods from both controller and runtime command surface', () => {
    const notifications = new RuntimeMobileNotificationController()
    const runtime = new OrcaRuntimeService()
    for (const method of [
      'setPushRegistrar',
      'testPushDevice',
      'registerPushDevice',
      'unregisterPushDevice'
    ]) {
      expect(method in notifications, method).toBe(false)
    }
    for (const method of [
      'setMobilePushRegistrar',
      'testMobilePushDevice',
      'registerMobilePushDevice',
      'unregisterMobilePushDevice'
    ]) {
      expect(method in runtime, method).toBe(false)
    }
  })

  it('continues local notification fan-out, epoch replay and listener teardown', () => {
    const notifications = new RuntimeMobileNotificationController()
    const delivered: unknown[] = []
    const stop = notifications.onDispatched((event) => delivered.push(event))
    expect(notifications.getListenerCount()).toBe(1)
    notifications.dispatch({
      type: 'notification',
      source: 'terminal-bell',
      title: 'Local terminal alert',
      body: 'Done'
    })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      type: 'notification',
      title: 'Local terminal alert',
      notificationSeq: 1,
      notificationEpoch: notifications.getEpoch()
    })
    expect(notifications.getMissedSince(0, notifications.getEpoch())).toEqual(delivered)
    stop()
    expect(notifications.getListenerCount()).toBe(0)
    notifications.dispatch({ type: 'notification', source: 'test', title: 'Second', body: 'OK' })
    expect(delivered).toHaveLength(1)
    expect(notifications.getMissedSince(1)).toHaveLength(1)
  })

  it('preserves the historical unregister outbox without contacting a gateway', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'ash-push-outbox-retained-'))
    const outbox = new PushUnregisterOutbox(userDataPath)
    const queued = outbox.enqueue({
      registrationId: 'legacy-registered-phone',
      deviceId: 'old-phone'
    })
    expect(
      outbox.enqueue({ registrationId: queued.registrationId, deviceId: 'old-phone' })
    ).toEqual(queued)
    expect(new PushUnregisterOutbox(userDataPath).pending()).toEqual([queued])
    expect(outbox.isUnreadable()).toBe(false)
  })
})
