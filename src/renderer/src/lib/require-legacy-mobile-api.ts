import type { MobileApi } from '../../../preload/api/mobile-api'

/** Fail-closed compatibility boundary for archived mobile pairing callers. */
export function requireLegacyMobileApi(): MobileApi {
  const api = window.api.mobile
  if (!api) {
    throw new Error('Mobile pairing is not available in Ash IDE')
  }
  return api
}
