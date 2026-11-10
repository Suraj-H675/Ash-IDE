import { expect, it } from 'vitest'
import { createWebTelemetryApi } from './web-telemetry-api'

it('keeps the Ash browser-facing telemetry bridge disabled with no enrollment or capture', async () => {
  const bridge = createWebTelemetryApi()
  await expect(bridge.telemetryTrack?.('app_opened', {})).resolves.toBe(false)
  await expect(bridge.telemetryGetConsentState?.()).resolves.toEqual({
    effective: 'disabled',
    reason: 'user_opt_out'
  })
  await expect(bridge.telemetrySetOptIn?.(true)).resolves.toBeUndefined()
  await expect(bridge.telemetryAcknowledgeBanner?.()).resolves.toBeUndefined()
})
