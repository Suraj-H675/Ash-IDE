import type { AutomationsApi } from '../../../preload/api/automation-api'

export function requireLegacyAutomationsApi(): AutomationsApi {
  const api = window.api.automations
  if (!api) {
    throw new Error('Scheduled automations are not available in Ash IDE')
  }
  return api
}
