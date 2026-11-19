/** Saved Orca settings retained when a profile is loaded or written. */
export type LegacyAppPluginSettings = {
  pluginSystemEnabled: boolean
  pluginSystemDefaultedOn?: boolean
  disabledPlugins: string[]
  pluginConsents: Record<string, string>
  devPluginPaths: string[]
  pluginReplacementsOff?: string[]
  pluginExternalHostGrants?: Record<string, string[]>
  pluginFullAccessEnabled?: boolean
  pluginFileTypeSuggestions?: boolean
  pluginDismissedFileTypes?: string[]
  pluginUpdatePolicy?: 'auto' | 'manual'
}
