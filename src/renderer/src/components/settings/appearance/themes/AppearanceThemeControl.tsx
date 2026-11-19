import type React from 'react'
import { Zap } from 'lucide-react'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import {
  editorThemeSlotUpdate,
  MATCH_TERMINAL_APP_THEME,
  pluginAppThemeSlotUpdate
} from '../../../../../../shared/plugin-theme-settings'
import { SettingsSearchableSelect } from '../../form-controls/SettingsSearchableSelect'
import { SettingsSegmentedControl } from '../../form-controls/SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { findCodeEditorTheme } from '@/lib/code-editor-theme'

type BuiltInTheme = GlobalSettings['theme']

const BUILT_IN = 'built-in'
const FOLLOW_APP = 'follow-app'

function builtInLabel(): string {
  return translate(
    'auto.components.settings.AppearanceInterfaceSection.pluginIconTheme.builtIn',
    'Built-in'
  )
}

function searchThemesLabel(): string {
  return translate('auto.components.settings.AppearanceThemeControl.searchThemes', 'Search themes…')
}

function noThemesLabel(): string {
  return translate(
    'auto.components.settings.AppearanceThemeControl.noThemes',
    'No themes match your search.'
  )
}

/** System, Dark or Light; the Light theme and Dark theme slots pick the colors for each. */
export function AppearanceThemeControl({
  label,
  settings,
  updateSettings,
  applyTheme
}: {
  label: string
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  applyTheme: (theme: BuiltInTheme) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <SettingsSegmentedControl
        ariaLabel={label}
        value={settings.theme}
        onChange={(theme) => {
          updateSettings({ theme })
          applyTheme(theme)
        }}
        options={[
          {
            value: 'system',
            label: translate('auto.components.settings.AppearancePane.fb0e0b4453', 'System')
          },
          {
            value: 'dark',
            label: translate('auto.components.settings.AppearancePane.7d26ccabe8', 'Dark')
          },
          {
            value: 'light',
            label: translate('auto.components.settings.AppearancePane.fd89b5487c', 'Light')
          }
        ]}
      />
    </div>
  )
}

/** Ash's supported per-mode app themes: built-in colors or Match Terminal. */
export function AppearanceThemeSlotSelect({
  base,
  label,
  settings,
  updateSettings
}: {
  base: 'light' | 'dark'
  label: string
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const selectedId = base === 'dark' ? settings.pluginAppThemeDark : settings.pluginAppThemeLight
  // Historical plugin theme IDs are only displayed as the built-in fallback;
  // opening Appearance does not silently overwrite saved settings.
  const value = selectedId === MATCH_TERMINAL_APP_THEME ? MATCH_TERMINAL_APP_THEME : BUILT_IN
  return (
    <div className="flex flex-col items-end gap-1">
      <SettingsSearchableSelect
        ariaLabel={label}
        value={value}
        searchPlaceholder={searchThemesLabel()}
        emptyText={noThemesLabel()}
        onValueChange={(next) => {
          updateSettings(
            pluginAppThemeSlotUpdate(
              base,
              next === MATCH_TERMINAL_APP_THEME ? MATCH_TERMINAL_APP_THEME : null
            )
          )
        }}
        groups={[
          {
            key: BUILT_IN,
            options: [
              { value: BUILT_IN, label: builtInLabel() },
              {
                value: MATCH_TERMINAL_APP_THEME,
                label: translate(
                  'auto.components.settings.AppearanceThemeControl.matchTerminal',
                  'Match Terminal'
                ),
                detail: (
                  <>
                    <Zap className="mr-1 size-3" aria-hidden />
                    {translate(
                      'auto.components.settings.AppearanceThemeControl.dynamic',
                      'dynamic'
                    )}
                  </>
                )
              }
            ]
          }
        ]}
      />
    </div>
  )
}

/** One mode's code editor theme: follow the app or use Monaco's built-in light/dark. */
export function CodeEditorThemeSelect({
  base,
  label,
  settings,
  updateSettings
}: {
  base: 'light' | 'dark'
  label: string
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const selected = findCodeEditorTheme(
    base === 'dark' ? settings.editorThemeDark : settings.editorThemeLight
  )
  return (
    <SettingsSearchableSelect
      ariaLabel={label}
      value={selected ?? FOLLOW_APP}
      searchPlaceholder={searchThemesLabel()}
      emptyText={noThemesLabel()}
      onValueChange={(value) =>
        updateSettings(
          editorThemeSlotUpdate(base, value === 'light' || value === 'dark' ? value : null)
        )
      }
      groups={[
        {
          key: FOLLOW_APP,
          options: [
            {
              value: FOLLOW_APP,
              label: translate('settings.appearance.editorTheme.followApp', 'Same as app theme')
            }
          ]
        },
        {
          key: BUILT_IN,
          heading: builtInLabel(),
          options: [
            {
              value: 'light',
              label: translate('auto.components.settings.AppearancePane.fd89b5487c', 'Light')
            },
            {
              value: 'dark',
              label: translate('auto.components.settings.AppearancePane.7d26ccabe8', 'Dark')
            }
          ]
        }
      ]}
    />
  )
}
