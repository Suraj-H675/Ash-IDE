import type React from 'react'

import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { UIZoomControl } from './UIZoomControl'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { ReduceVisualEffectsSetting } from './ReduceVisualEffectsSetting'
import { getReduceVisualEffectsEntries } from './appearance-reduce-visual-effects-search'
import { AppearanceAdvancedDisclosure } from './AppearanceAdvancedDisclosure'
import { useAppStore } from '../../../store/index'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { ShortcutHintList } from './AppearanceShortcutHintList'
import { FontAutocomplete } from './fonts/FontAutocomplete'
import { SettingsRow, SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { DEFAULT_APP_FONT_FAMILY } from '../../../../../shared/constants'
import {
  getCodeEditorThemeEntries,
  getThemeEntries,
  getTitlebarEntries,
  getTypographyEntries,
  getZoomEntries
} from './appearance-search'
import { getMenuBarIconEntries, getSystemTrayEntries } from './appearance-system-presence-search'
import { translate } from '@/i18n/i18n'
import { matchesSettingsSearch, normalizeSettingsSearchQuery } from '../search/settings-search'
import { translateSearchKeyword } from '../search/settings-search-keywords'
import {
  AppearanceThemeControl,
  AppearanceThemeSlotSelect,
  CodeEditorThemeSelect
} from './themes/AppearanceThemeControl'

type AppearanceInterfaceSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  applyTheme: (theme: 'system' | 'dark' | 'light') => void
  fontSuggestions: string[]
  isDesktopMac: boolean
  isDesktopWindows: boolean
  onRequestFontSuggestions?: () => void
  forceVisiblePrimary?: boolean
}

export function AppearanceInterfaceSection({
  settings,
  updateSettings,
  applyTheme,
  fontSuggestions,
  isDesktopMac,
  isDesktopWindows,
  onRequestFontSuggestions,
  forceVisiblePrimary = false
}: AppearanceInterfaceSectionProps): React.JSX.Element {
  const searchQuery = useAppStore((state) => state.settingsSearchQuery)
  const themeSlots = [
    {
      base: 'light' as const,
      title: translate(
        'auto.components.settings.AppearanceInterfaceSection.lightTheme',
        'Light theme'
      )
    },
    {
      base: 'dark' as const,
      title: translate(
        'auto.components.settings.AppearanceInterfaceSection.darkTheme',
        'Dark theme'
      )
    }
  ]
  const editorThemeEntry = getCodeEditorThemeEntries()[0]
  const editorThemeSlots = [
    {
      base: 'light' as const,
      title: translate('settings.appearance.editorTheme.light', 'Light editor theme'),
      description: translate(
        'settings.appearance.editorTheme.lightDescription',
        'Code editor, diff and notebook colors while the app is light.'
      )
    },
    {
      base: 'dark' as const,
      title: translate('settings.appearance.editorTheme.dark', 'Dark editor theme'),
      description: translate(
        'settings.appearance.editorTheme.darkDescription',
        'Code editor, diff and notebook colors while the app is dark.'
      )
    }
  ]
  const isSearching = normalizeSettingsSearchQuery(searchQuery).length > 0
  const zoomInKeyCombos = useShortcutKeyComboDetails('zoom.in')
  const zoomOutKeyCombos = useShortcutKeyComboDetails('zoom.out')
  const menuBarIconEntry = getMenuBarIconEntries({ showMenuBarIcon: true })[0]
  const systemTrayEntry = getSystemTrayEntries({ showSystemTray: true })[0]
  const themeEntry = getThemeEntries()[0]
  const themeLabel = translate('auto.components.settings.AppearancePane.932ff1fbff', 'Theme')
  const titlebarEntry = getTitlebarEntries()[0]
  const typographyEntry = getTypographyEntries()[0]
  const zoomEntry = getZoomEntries()[0]
  const reduceVisualEffectsEntry = getReduceVisualEffectsEntries()[0]
  const advancedEntries = [
    ...getTitlebarEntries(),
    ...getReduceVisualEffectsEntries(),
    ...getSystemTrayEntries({ showSystemTray: isDesktopWindows }),
    ...getMenuBarIconEntries({ showMenuBarIcon: isDesktopMac })
  ]
  const showAdvanced = !isSearching || matchesSettingsSearch(searchQuery, advancedEntries)
  return (
    <div className="divide-y divide-border/40">
      <SearchableSetting
        title={themeLabel}
        description={themeEntry?.description}
        keywords={themeEntry?.keywords ?? ['dark', 'light', 'system']}
        forceVisible={forceVisiblePrimary}
      >
        <SettingsRow
          label={themeLabel}
          control={
            <AppearanceThemeControl
              label={themeLabel}
              settings={settings}
              updateSettings={updateSettings}
              applyTheme={applyTheme}
            />
          }
        />
      </SearchableSetting>

      {themeSlots.map((slot) => (
        <SearchableSetting
          key={slot.base}
          title={slot.title}
          description={translate(
            'auto.components.settings.AppearanceInterfaceSection.themeSlot.description',
            'App colors for this mode.'
          )}
          keywords={[
            'theme',
            'terminal',
            slot.base,
            ...translateSearchKeyword(
              'auto.components.settings.appearance.search.matchTerminal',
              'match terminal'
            )
          ]}
          forceVisible={forceVisiblePrimary}
        >
          <SettingsRow
            label={slot.title}
            control={
              <AppearanceThemeSlotSelect
                base={slot.base}
                label={slot.title}
                settings={settings}
                updateSettings={updateSettings}
              />
            }
          />
        </SearchableSetting>
      ))}

      {editorThemeSlots.map((slot) => (
        <SearchableSetting
          key={slot.base}
          title={slot.title}
          description={editorThemeEntry?.description}
          keywords={editorThemeEntry?.keywords ?? []}
          forceVisible={forceVisiblePrimary}
        >
          <SettingsRow
            label={slot.title}
            description={slot.description}
            control={
              <CodeEditorThemeSelect
                base={slot.base}
                label={slot.title}
                settings={settings}
                updateSettings={updateSettings}
              />
            }
          />
        </SearchableSetting>
      ))}

      <SearchableSetting
        title={translate('auto.components.settings.AppearancePane.5e6d7aba8d', 'UI Zoom')}
        description={zoomEntry?.description}
        keywords={zoomEntry?.keywords ?? ['zoom', 'scale', 'shortcut']}
        forceVisible={forceVisiblePrimary}
      >
        <SettingsRow
          label={translate('auto.components.settings.AppearancePane.5e6d7aba8d', 'UI Zoom')}
          // Explain the shortcut and terminal exception; the zoom buttons already explain scaling.
          description={
            <>
              <ShortcutHintList combos={zoomInKeyCombos} /> /{' '}
              <ShortcutHintList combos={zoomOutKeyCombos} />{' '}
              {translate(
                'auto.components.settings.AppearancePane.ef89200c1f',
                'when not in a terminal pane.'
              )}
            </>
          }
          control={<UIZoomControl />}
        />
      </SearchableSetting>

      <SearchableSetting
        title={translate('auto.components.settings.AppearancePane.102d6b5f9b', 'IDE Font')}
        description={typographyEntry?.description}
        keywords={typographyEntry?.keywords ?? ['font', 'typeface', 'typography']}
        forceVisible={forceVisiblePrimary}
      >
        <SettingsRow
          label={translate('auto.components.settings.AppearancePane.102d6b5f9b', 'IDE Font')}
          control={
            <FontAutocomplete
              value={settings.appFontFamily}
              suggestions={fontSuggestions}
              placeholder={DEFAULT_APP_FONT_FAMILY}
              onRequestSuggestions={onRequestFontSuggestions}
              onChange={(value) =>
                updateSettings({ appFontFamily: value.trim() || DEFAULT_APP_FONT_FAMILY })
              }
            />
          }
        />
      </SearchableSetting>

      {showAdvanced ? (
        <AppearanceAdvancedDisclosure showTopBorder={false}>
          <div className="divide-y divide-border/40">
            <SearchableSetting
              title={translate(
                'auto.components.settings.AppearancePane.9868f39007',
                'Titlebar App Name'
              )}
              description={titlebarEntry?.description}
              keywords={titlebarEntry?.keywords ?? ['titlebar', 'orca', 'app', 'name']}
            >
              <SettingsSwitchRow
                label={translate(
                  'auto.components.settings.AppearancePane.9868f39007',
                  'Titlebar App Name'
                )}
                checked={settings.showTitlebarAppName}
                onChange={() =>
                  updateSettings({ showTitlebarAppName: !settings.showTitlebarAppName })
                }
              />
            </SearchableSetting>

            <ReduceVisualEffectsSetting
              entry={reduceVisualEffectsEntry}
              enabled={settings.reduceVisualEffects === true}
              updateSettings={updateSettings}
            />

            {isDesktopWindows ? (
              <SearchableSetting
                title={translate(
                  'auto.components.settings.AppearancePane.2edf606c46',
                  'Minimize to Tray on Close'
                )}
                description={systemTrayEntry?.description}
                keywords={systemTrayEntry?.keywords ?? ['tray', 'minimize', 'close']}
              >
                <SettingsSwitchRow
                  label={translate(
                    'auto.components.settings.AppearancePane.2edf606c46',
                    'Minimize to Tray on Close'
                  )}
                  // Explain the non-obvious platform restriction and keep-running consequence.
                  description={translate(
                    'auto.components.settings.AppearancePane.b707773a0d',
                    'When enabled, closing the window keeps Orca running in the system tray instead of quitting.'
                  )}
                  checked={settings.minimizeToTrayOnClose === true}
                  onChange={() =>
                    updateSettings({ minimizeToTrayOnClose: !settings.minimizeToTrayOnClose })
                  }
                />
              </SearchableSetting>
            ) : null}

            {isDesktopMac ? (
              <SearchableSetting
                title={translate('settings.appearance.menuBarIcon.title', 'Show Menu Bar Icon')}
                description={menuBarIconEntry?.description}
                keywords={menuBarIconEntry?.keywords ?? ['menu bar', 'status item', 'activity']}
              >
                <SettingsSwitchRow
                  label={translate('settings.appearance.menuBarIcon.title', 'Show Menu Bar Icon')}
                  // Hiding the status item preserves Dock activation and close-keeps-running behavior.
                  description={translate(
                    'settings.appearance.menuBarIcon.description',
                    'Keep an Orca shortcut and activity indicator in the macOS menu bar.'
                  )}
                  checked={settings.showMenuBarIcon !== false}
                  onChange={() =>
                    updateSettings({ showMenuBarIcon: settings.showMenuBarIcon === false })
                  }
                />
              </SearchableSetting>
            ) : null}
          </div>
        </AppearanceAdvancedDisclosure>
      ) : null}
    </div>
  )
}
