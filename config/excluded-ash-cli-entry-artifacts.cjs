// Compiled artifacts from excluded app-level CLI capabilities. Ash's public
// command registry does not register these commands. TypeScript still emits
// their source modules for source-level compatibility/test coverage; the
// installed native CLI must not ship the otherwise unused entrypoints.
// Keep this list exact: browser extensions, provider-native agents/MCP and
// built-in syntax highlighting are retained product functionality.
const EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS = Object.freeze([
  'out/cli/handlers/speech.js',
  'out/cli/runtime/serve-speech-recognizer.js',
  'out/cli/specs/speech.js',
  'out/cli/plugin-handler-groups.js',
  'out/cli/specs/plugin.js',
  'out/cli/specs/plugin-view.js',
  'out/cli/specs/plugin-dev-request.js',
  'out/cli/handlers/plugin-authoring.js',
  'out/cli/handlers/plugin-dev-emit.js',
  'out/cli/handlers/plugin-dev-request.js',
  'out/cli/handlers/plugin-dev-watch.js',
  'out/cli/handlers/plugin-runtime.js',
  'out/cli/handlers/plugin-shot-chrome.js',
  'out/cli/handlers/plugin-shot-default-dir.js',
  'out/cli/handlers/plugin-shot-editor.js',
  'out/cli/handlers/plugin-shot-scenario.js',
  'out/cli/handlers/plugin-view.js'
])

module.exports = { EXCLUDED_ASH_CLI_ENTRY_ARTIFACTS }
