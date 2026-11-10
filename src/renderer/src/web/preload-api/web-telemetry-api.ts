import type { PreloadApi } from '../../../../preload/api-types'

export function createWebTelemetryApi(): Partial<PreloadApi> {
  return {
    telemetryTrack: () => Promise.resolve(false),
    telemetrySetOptIn: () => Promise.resolve(),
    telemetryGetConsentState: () =>
      Promise.resolve({ effective: 'disabled', reason: 'user_opt_out' }),
    telemetryAcknowledgeBanner: () => Promise.resolve()
  }
}
