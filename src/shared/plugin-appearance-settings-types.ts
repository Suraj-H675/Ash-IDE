import type { TerminalPluginPalette } from './terminal-themes/terminal-color-overrides'

/** The built-in editor colors and legacy selections retained for profile compatibility. */
export type CodeEditorThemeChoice = 'light' | 'dark' | `plugin:${string}`

/** Match Terminal and legacy app theme identifiers. */
export type AppThemeSlotSelection = `plugin:${string}` | 'match-terminal'

/** Saved appearance preferences. Legacy field names stay stable on disk. */
export type AppearanceThemeSettings = {
  /** App theme painted while Orca is light; null keeps the built-in colors. */
  pluginAppThemeLight?: AppThemeSlotSelection | null
  /** App theme painted while Orca is dark; null keeps the built-in colors. */
  pluginAppThemeDark?: AppThemeSlotSelection | null
  /** Code editor colors while Orca is light; null follows the app theme. */
  editorThemeLight?: CodeEditorThemeChoice | null
  /** Code editor colors while Orca is dark; null follows the app theme. */
  editorThemeDark?: CodeEditorThemeChoice | null
  /** Legacy single app-theme selection. */
  pluginAppTheme?: `plugin:${string}` | null
  /** Legacy companion of `pluginAppTheme`. */
  themeBeforePlugin?: 'system' | 'dark' | 'light' | null
  /** A plugin icon theme's id for file and folder icons; null keeps the built-in icons. */
  pluginIconTheme?: `plugin:${string}` | null
  /** Saved terminal palette snapshots are plain colors that also work without a renderer. */
  terminalPluginPalettes?: TerminalPluginPalette[]
}
