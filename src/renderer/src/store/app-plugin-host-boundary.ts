/**
 * Ash excludes Orca's general application plugin host and marketplace (D-007).
 * This flag does not apply to Chromium browser extensions or provider-native
 * skills/MCP integrations, which have their own independent lifecycles.
 */
export const ASH_APP_PLUGIN_HOST_ENABLED = false
