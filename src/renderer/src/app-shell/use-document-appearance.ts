import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { buildAppFontFamily } from '@/lib/app-font-family'
import { applyCodeFontSmoothing } from '@/lib/code-font-smoothing'
import { applyMarkdownCodeFontFamily } from '@/lib/markdown-code-font'
import { useSplitDividerSetting } from '@/hooks/use-split-divider-setting'
import { rebuildAllTerminalWebglRenderers } from '@/lib/pane-manager/pane-manager-registry'
import { applyDocumentTheme, applyAppTheme } from '../lib/document-theme'
import {
  findCodeEditorTheme,
  paintCodeEditorColors,
  resolveCodeEditorTheme
} from '../lib/code-editor-theme'
import { browserColorProbe } from '../lib/app-theme-colors'
import { useCodeEditorThemeStore } from '../store/code-editor-theme'
import { synthesizeTerminalAppTheme, type TerminalAppTheme } from '../lib/terminal-app-theme'
import { MATCH_TERMINAL_APP_THEME } from '../../../shared/plugin-theme-settings'
import { scheduleRuntimeGraphSync } from '../runtime/sync-runtime-graph'
import { useAppStore } from '../store'
import { useDocumentDarkTheme, useSettingsDarkTheme } from '@/hooks/use-document-dark-theme'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'

/** The Match Terminal app theme while the requested mode's slot selects it, else null. */
function useTerminalAppTheme(selected: boolean): TerminalAppTheme | null {
  const systemPrefersDark = useSystemPrefersDark()
  // Why only these fields: unrelated settings writes must not re-derive and repaint the theme.
  const inputs = useAppStore(
    useShallow((s) =>
      selected && s.settings
        ? {
            theme: s.settings.theme,
            terminalThemeDark: s.settings.terminalThemeDark,
            terminalThemeLight: s.settings.terminalThemeLight,
            terminalUseSeparateLightTheme: s.settings.terminalUseSeparateLightTheme,
            terminalCustomThemes: s.settings.terminalCustomThemes,
            terminalPluginPalettes: s.settings.terminalPluginPalettes,
            pluginSystemEnabled: s.settings.pluginSystemEnabled,
            pluginSystemDefaultedOn: s.settings.pluginSystemDefaultedOn,
            disabledPlugins: s.settings.disabledPlugins,
            terminalColorOverrides: s.settings.terminalColorOverrides,
            terminalColorOverridesLight: s.settings.terminalColorOverridesLight
          }
        : null
    )
  )
  return useMemo(
    () =>
      inputs ? synthesizeTerminalAppTheme(inputs, systemPrefersDark, browserColorProbe) : null,
    [inputs, systemPrefersDark]
  )
}

export function useDocumentAppearance(): void {
  const theme = useAppStore((s) => s.settings?.theme)
  const requestedDark = useSettingsDarkTheme()
  const dark = useDocumentDarkTheme()
  const selected = useAppStore((s) =>
    requestedDark ? s.settings?.pluginAppThemeDark : s.settings?.pluginAppThemeLight
  )
  const appTheme = useTerminalAppTheme(selected === MATCH_TERMINAL_APP_THEME)
  const editorTheme = findCodeEditorTheme(
    useAppStore((s) => (dark ? s.settings?.editorThemeDark : s.settings?.editorThemeLight))
  )
  const appPainted = useRef<Readonly<Record<string, string>>>({})
  useSplitDividerSetting()
  const appFontFamily = useAppStore((s) => s.settings?.appFontFamily)
  const codeFontSmoothing = useAppStore((s) => s.settings?.codeFontSmoothing)
  const editorFontFamily = useAppStore((s) => s.settings?.editorFontFamily)

  // Why `dark` too: a system theme repaints when the OS flips, before the slot paint below.
  useEffect(() => {
    if (theme) {
      // Why the painted mode: Match Terminal may show a terminal theme of the other mode.
      applyDocumentTheme(dark ? 'dark' : 'light')
    }
    if (theme === 'system') {
      // System theme changes don't mutate the store, so mobile terminal colors need an explicit graph republish.
      scheduleRuntimeGraphSync()
    }
    // Why requestedDark: an OS flip can change the terminal palette without changing `dark`.
  }, [theme, dark, requestedDark])

  useEffect(() => {
    if (theme) {
      appPainted.current = applyAppTheme(appTheme)
    }
  }, [appTheme, theme, dark])

  // The followed editor reads the colors the preceding effect painted.
  useEffect(() => {
    if (!theme) {
      return
    }
    const computed = getComputedStyle(document.documentElement)
    const codeEditorTheme = resolveCodeEditorTheme({
      dark,
      appTheme,
      selected: editorTheme,
      appPainted: appPainted.current,
      readDocument: (token) => computed.getPropertyValue(token),
      probe: browserColorProbe
    })
    paintCodeEditorColors(codeEditorTheme.override)
    useCodeEditorThemeStore.setState(codeEditorTheme)
  }, [appTheme, editorTheme, theme, dark])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--app-font-family',
      buildAppFontFamily(appFontFamily)
    )
  }, [appFontFamily])

  useEffect(() => {
    applyMarkdownCodeFontFamily(editorFontFamily)
  }, [editorFontFamily])

  useEffect(() => {
    // WebGL glyph atlases keep the smoothing they were created with; rebuild only on a real change.
    if (applyCodeFontSmoothing(codeFontSmoothing)) {
      rebuildAllTerminalWebglRenderers('code-font-smoothing')
    }
  }, [codeFontSmoothing])
}
