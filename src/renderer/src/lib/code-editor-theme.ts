import type { CodeEditorThemeChoice } from '../../../shared/plugin-appearance-settings-types'
import { deriveMonacoTheme, type MonacoPaletteTheme } from './monaco-palette-theme'
import type { TerminalAppTheme } from './terminal-app-theme'
import type { ColorProbe } from './app-theme-colors'

type ThemeBase = 'light' | 'dark'

/** Colors for the code surfaces Orca paints itself (notebook cells, code excerpts, prompt box). */
export type CodeEditorColors = {
  background: string
  foreground: string
  mutedForeground: string
  border: string
}

/** An editor theme chosen apart from the app theme; its base can differ from the app's mode. */
export type CodeEditorThemeOverride = { base: ThemeBase; colors: CodeEditorColors }

export type CodeEditorTheme = {
  /** Null keeps Monaco's built-in vs / vs-dark. */
  monaco: MonacoPaletteTheme | null
  /** Null while the editor follows the app theme. */
  override: CodeEditorThemeOverride | null
}

// Why Monaco's own vs / vs-dark colors: Orca's code surfaces must match what Monaco paints.
const BUILT_IN_COLORS: Record<ThemeBase, CodeEditorColors> = {
  light: {
    background: '#fffffe',
    foreground: '#000000',
    mutedForeground: '#237893',
    border: '#c8c8c8'
  },
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    mutedForeground: '#858585',
    border: '#454545'
  }
}

export function findCodeEditorTheme(
  choice: CodeEditorThemeChoice | null | undefined
): ThemeBase | null {
  return choice === 'light' || choice === 'dark' ? choice : null
}

/** The theme every Monaco surface uses for the app's current mode. */
export function resolveCodeEditorTheme(input: {
  dark: boolean
  appTheme: TerminalAppTheme | null
  selected: ThemeBase | null
  appPainted: Readonly<Record<string, string>>
  readDocument: (token: string) => string
  probe: ColorProbe
}): CodeEditorTheme {
  const { appTheme, selected } = input
  if (selected && (appTheme || selected !== (input.dark ? 'dark' : 'light'))) {
    return { monaco: null, override: { base: selected, colors: BUILT_IN_COLORS[selected] } }
  }
  return {
    monaco: appTheme
      ? deriveMonacoTheme({
          base: appTheme.base,
          read: input.readDocument,
          painted: input.appPainted,
          probe: input.probe,
          tokenColors: appTheme.tokenColors
        })
      : null,
    override: null
  }
}

const COLOR_PROPERTIES = [
  ['background', '--code-editor-background'],
  ['foreground', '--code-editor-foreground'],
  ['mutedForeground', '--code-editor-muted-foreground'],
  ['border', '--code-editor-border']
] as const

type CodeEditorColorsRoot = Pick<HTMLElement, 'dataset'> & {
  style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
}

/** Publishes an override's colors on the root; `.code-editor-colors` surfaces read them. */
export function paintCodeEditorColors(
  override: CodeEditorThemeOverride | null,
  root: CodeEditorColorsRoot = document.documentElement
): void {
  for (const [key, property] of COLOR_PROPERTIES) {
    if (override) {
      root.style.setProperty(property, override.colors[key])
    } else {
      root.style.removeProperty(property)
    }
  }
  if (override) {
    root.dataset.codeEditorTheme = override.base
  } else {
    delete root.dataset.codeEditorTheme
  }
}
