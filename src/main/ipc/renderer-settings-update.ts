import type { GlobalSettings } from '../../shared/global-settings-types'

type LegacyTerminalScrollbackSettingsUpdate = Partial<GlobalSettings> & {
  terminalScrollbackBytes?: unknown
}

export function sanitizeRendererSettingsUpdate(
  args: Partial<GlobalSettings>
): Partial<GlobalSettings> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This legacy field is removed before the typed update is returned.
  const { terminalScrollbackBytes: _legacyScrollbackBytes, ...sanitizedArgs } =
    args as LegacyTerminalScrollbackSettingsUpdate
  void _legacyScrollbackBytes
  // Keep inherited app-plugin records read-only across generic renderer updates.
  delete sanitizedArgs.pluginSystemEnabled
  delete sanitizedArgs.pluginSystemDefaultedOn
  delete sanitizedArgs.devPluginPaths
  delete sanitizedArgs.pluginReplacementsOff
  delete sanitizedArgs.pluginFullAccessEnabled
  delete sanitizedArgs.pluginFileTypeSuggestions
  delete sanitizedArgs.pluginDismissedFileTypes
  delete sanitizedArgs.pluginUpdatePolicy
  delete sanitizedArgs.pluginConsents
  delete sanitizedArgs.disabledPlugins
  delete sanitizedArgs.pluginExternalHostGrants
  if (
    'browserPasswordsFillRequiresReauth' in sanitizedArgs &&
    typeof sanitizedArgs.browserPasswordsFillRequiresReauth !== 'boolean'
  ) {
    delete sanitizedArgs.browserPasswordsFillRequiresReauth
  }
  return sanitizedArgs
}
