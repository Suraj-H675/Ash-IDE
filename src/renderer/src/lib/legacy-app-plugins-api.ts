import type { PluginsApi } from '../../../preload/api/plugin-host-api'

/**
 * Temporary compile-time boundary for inherited Orca plugin-manager modules
 * that no longer have an Ash navigation or startup entrypoint.
 *
 * Ash's Electron and web preloads expose NO `plugins` namespace. Do not
 * replace this with a synthetic installer, RPC proxy, or success-shaped stub.
 * Later M8 source cleanup removes the remaining orphaned consumers entirely.
 */
export function requireLegacyAppPluginsApi(): PluginsApi {
  const api = window.api?.plugins
  if (!api) {
    throw new Error('Application plugins are not supported in Ash IDE')
  }
  return api
}
