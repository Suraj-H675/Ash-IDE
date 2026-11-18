// @vitest-environment happy-dom

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { normalizeUiLanguage } from '../../../shared/ui-language'
import { useAppStore } from '../store'
import { migrateStoredWebSettings } from '../web/preload-api/web-preference-normalization'
import { I18nProvider } from './I18nProvider'
import { getIntlLocale, i18n } from './i18n'
import { useLanguageReadiness } from './language-readiness'

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash English-only UI', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null
  let previousSettings: ReturnType<typeof useAppStore.getState>['settings']
  let priorApi: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    previousSettings = useAppStore.getState().settings
    priorApi = Object.getOwnPropertyDescriptor(window, 'api')
    useLanguageReadiness.setState({ ready: false })
  })

  afterEach(async () => {
    if (root) {
      act(() => root?.unmount())
    }
    host?.remove()
    host = null
    root = null
    useAppStore.setState({ settings: previousSettings })
    useLanguageReadiness.setState({ ready: false })
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    if (priorApi) {
      Object.defineProperty(window, 'api', priorApi)
    } else {
      Reflect.deleteProperty(window, 'api')
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('forces English promptly and leaves a saved plugin locale untouched', async () => {
    const legacyLanguage = 'plugin:stablyai.orca-portuguese/pt-BR'
    useAppStore.setState({
      settings: { ...getDefaultSettings('~'), uiLanguage: legacyLanguage }
    })
    const updateSettings = vi.spyOn(useAppStore.getState(), 'updateSettings')
    await act(async () => {
      await i18n.changeLanguage('ja')
    })

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(createElement(I18nProvider, null, createElement('span', null, 'English UI')))
    })
    await vi.waitFor(() => expect(useLanguageReadiness.getState().ready).toBe(true), {
      timeout: 500
    })

    expect(i18n.language).toBe('en')
    expect(getIntlLocale()).toBe('en')
    expect(host?.textContent).toBe('English UI')
    expect(useAppStore.getState().settings?.uiLanguage).toBe(legacyLanguage)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('defaults new and missing language preferences to English while preserving saved values', () => {
    const legacyLanguage = 'plugin:stablyai.orca-portuguese/pt-BR'
    expect(getDefaultSettings('~').uiLanguage).toBe('en')
    expect(normalizeUiLanguage(undefined)).toBe('en')
    expect(normalizeUiLanguage('system')).toBe('system')
    expect(normalizeUiLanguage('ja')).toBe('ja')
    expect(normalizeUiLanguage(legacyLanguage)).toBe(legacyLanguage)
  })

  it('preserves the old plugin locale and migration marker in stored web settings', () => {
    const legacyLanguage = 'plugin:stablyai.orca-portuguese/pt-BR'
    const settings = migrateStoredWebSettings({
      uiLanguage: legacyLanguage,
      uiLanguagePortugueseMigrationApplied: false
    })
    expect(settings.uiLanguage).toBe(legacyLanguage)
    expect(settings.uiLanguagePortugueseMigrationApplied).toBe(false)
  })

  it('keeps the existing AppRootSurfaces readiness gate attached to provider readiness', () => {
    const source = readSource('src/renderer/src/app-shell/AppRootSurfaces.tsx')
    expect(source).toContain('useLanguageReadiness((state) => state.ready)')
    expect(source).toContain('{languageReady ? (')
  })

  it('removes the Appearance language picker, search entry, and summary', () => {
    const interfaceSection = readSource(
      'src/renderer/src/components/settings/appearance/AppearanceInterfaceSection.tsx'
    )
    const pane = readSource('src/renderer/src/components/settings/appearance/AppearancePane.tsx')
    const search = readSource(
      'src/renderer/src/components/settings/appearance/appearance-search.ts'
    )
    const summary = readSource(
      'src/renderer/src/components/settings/appearance/appearance-interface-summary.ts'
    )
    for (const source of [interfaceSection, pane, search, summary]) {
      expect(source).not.toContain('SHOW_UI_LANGUAGE_SETTING')
      expect(source).not.toContain('getLanguageEntries')
      expect(source).not.toContain('settings.appearance.language')
    }
    expect(interfaceSection).not.toContain('pluginLanguagePacks')
    expect(interfaceSection).not.toContain('uiLanguage')
    expect(existsSync(resolve(process.cwd(), 'src/renderer/src/i18n/supported-languages.ts'))).toBe(
      false
    )
  })

  it('removes the onboarding switcher and its keyboard gating', () => {
    const onboarding = readSource('src/renderer/src/components/onboarding/OnboardingFlow.tsx')
    expect(onboarding).not.toContain('OnboardingLanguageSwitcher')
    expect(onboarding).not.toContain('languagePickerOpen')
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/renderer/src/components/onboarding/OnboardingLanguageSwitcher.tsx'
        )
      )
    ).toBe(false)
  })

  it('removes renderer plugin language-pack runtime files and imports', () => {
    const rendererFiles = [
      'src/renderer/src/i18n/I18nProvider.tsx',
      'src/renderer/src/i18n/i18n.ts',
      'src/renderer/src/hooks/useMacosTccPromptNotice.ts',
      'src/renderer/src/hooks/useMacTccAttributionSeveredNotice.ts'
    ]
    for (const path of rendererFiles) {
      const source = readSource(path)
      expect(source).not.toMatch(
        /PluginsApi|window\.api\.plugins|plugin-language-pack|PluginLanguagePack/
      )
    }
    expect(
      existsSync(resolve(process.cwd(), 'src/renderer/src/store/plugin-language-packs.ts'))
    ).toBe(false)
    expect(
      existsSync(
        resolve(process.cwd(), 'src/shared/plugins/plugin-language-pack-i18n-resources.ts')
      )
    ).toBe(false)
  })

  it('does not retain UI locale loading or startup migration paths', () => {
    const rendererI18n = readSource('src/renderer/src/i18n/i18n.ts')
    const mainI18n = readSource('src/main/i18n/main-i18n.ts')
    const loadedSettings = readSource(
      'src/main/persistence/loading-store/prepare-loaded-profile-settings.ts'
    )
    const webPreferences = readSource('src/renderer/src/web/preload-api/web-preferences-store.ts')
    expect(rendererI18n).not.toMatch(/locales\/(?:de|es|fr|ja|ko|pt|ru|tr|zh)/)
    expect(rendererI18n).not.toMatch(/loadRendererUiLanguage|loadLocaleCatalog|setRendererPlugin/)
    expect(mainI18n).not.toMatch(/LAZY_LOCALE|renderer\/src\/i18n\/locales|system-language/)
    expect(loadedSettings).not.toContain('migratePortugueseUiLanguageOnLoad')
    expect(webPreferences).not.toContain('uiLanguagePortugueseMigrationApplied !== true')
  })
})
