import { expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { resolveTerminalPalette } from '../../../shared/terminal-themes/terminal-theme-selection'
import { sanitizeRendererSettingsUpdate } from '../../ipc/renderer-settings-update'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'
import { prepareLoadedTerminalSettings } from './prepare-loaded-terminal-settings'

it('loads retired settings and saved palette colors without scheduling a migration write', () => {
  const parsed = getDefaultPersistedState('/fixture')
  // Model a profile that has already run the unrelated legacy default migrations.
  const savedTerminal = prepareLoadedTerminalSettings(parsed, () => {})
  const savedProfile = prepareLoadedProfileSettings(parsed, savedTerminal.defaults, () => {})
  parsed.settings = normalizeLoadedGlobalSettings(parsed, savedTerminal, savedProfile)
  const selection = 'plugin:fixture.theme/colors' as const
  const colors = { background: '#123456', foreground: '#fedcba', blue: '#5577ff' }
  const legacySettings = {
    pluginSystemEnabled: false,
    pluginConsents: { 'fixture.theme': 'old-fingerprint' },
    pluginFullAccessEnabled: false,
    devPluginPaths: ['/fixture/plugin'],
    pluginUpdatePolicy: 'manual' as const,
    pluginFileTypeSuggestions: false,
    pluginDismissedFileTypes: ['foo'],
    pluginAppThemeDark: selection,
    terminalPluginPalettes: [{ id: selection, colors }]
  }
  Object.assign(parsed.settings, legacySettings, { theme: 'dark', terminalThemeDark: selection })
  const before = structuredClone(parsed.settings)
  const markNeedsSave = vi.fn()
  const terminal = prepareLoadedTerminalSettings(parsed, markNeedsSave)
  const profile = prepareLoadedProfileSettings(parsed, terminal.defaults, markNeedsSave)
  const settings = normalizeLoadedGlobalSettings(parsed, terminal, profile)

  expect(settings).toMatchObject(legacySettings)
  expect(settings.pluginSystemDefaultedOn).toBeUndefined()
  expect(parsed.settings).toEqual(before)
  expect(markNeedsSave).not.toHaveBeenCalled()
  expect(resolveTerminalPalette(settings, true).theme).toMatchObject(colors)
  const optedOut = { ...settings, pluginSystemDefaultedOn: true }
  expect(resolveTerminalPalette(optedOut, true).theme).not.toMatchObject(colors)
  expect(
    sanitizeRendererSettingsUpdate({
      theme: 'light',
      pluginSystemEnabled: true,
      devPluginPaths: [],
      pluginConsents: {}
    })
  ).toEqual({ theme: 'light' })
})
