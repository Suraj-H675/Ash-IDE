// General application plugins (EX-03) are distinct from retained Chromium
// browser extensions and provider-native skills, MCP integrations and hooks.
// Keep the exact standalone executables separate from source-root/resource
// trees so package verification can detect reintroduced entries independently.
const EXCLUDED_APP_PLUGIN_EXECUTABLES = Object.freeze([
  'out/main/plugin-host-entry.js',
  'out/main/plugins/plugin-authoring-checks.js'
])

// These standalone compiled CommonJS trees have no external static importer
// in the reviewed packaged JS graph. Their source may separately appear in
// Electron/renderer bundles; those are different entrypoints and must be
// reviewed separately. Do not exclude built-in editor support, Chromium
// extensions, or provider-native skill/MCP integrations by directory name.
const EXCLUDED_APP_PLUGIN_SHARED_CJS_ROOTS = Object.freeze([
  'out/shared/plugins/approval',
  'out/shared/plugins/declarative/runtime',
  'out/shared/plugins/declarative/testing'
])
const EXCLUDED_APP_PLUGIN_SOURCE_ROOT = 'resources/plugins'
const EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT = 'plugins'

module.exports = {
  EXCLUDED_APP_PLUGIN_EXECUTABLES,
  EXCLUDED_APP_PLUGIN_SHARED_CJS_ROOTS,
  EXCLUDED_APP_PLUGIN_SOURCE_ROOT,
  EXCLUDED_APP_PLUGIN_NATIVE_RESOURCES_ROOT
}
