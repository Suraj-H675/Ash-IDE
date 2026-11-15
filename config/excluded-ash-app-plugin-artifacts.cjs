// General application plugins (EX-03) are distinct from retained Chromium
// browser extensions and provider-native skills, MCP integrations and hooks.
// Keep the exact standalone executables separate from source-root/resource
// trees so package verification can detect reintroduced entries independently.
const EXCLUDED_APP_PLUGIN_EXECUTABLES = Object.freeze([
  'out/main/plugin-host-entry.js',
  'out/main/plugins/plugin-authoring-checks.js'
])
const EXCLUDED_APP_PLUGIN_SOURCE_ROOT = 'resources/plugins'
const EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT = 'plugins'

module.exports = {
  EXCLUDED_APP_PLUGIN_EXECUTABLES,
  EXCLUDED_APP_PLUGIN_SOURCE_ROOT,
  EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT
}
