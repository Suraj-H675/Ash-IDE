import type { i18n as I18nInstance } from 'i18next'

import { createOrcaI18n } from '../../shared/orca-i18n-instance'
import { DEFAULT_UI_LOCALE } from '../../shared/ui-locale'
import type { UiLanguage } from '../../shared/ui-language'

// Initializes synchronously so startup dialogs always use the same English UI as the renderer.
const orcaI18n = createOrcaI18n({ englishResources: {} })

export const mainI18n: I18nInstance = orcaI18n.i18n
export const translateMain = orcaI18n.translate

/** Legacy callers can still request a UI language, but every request resolves to English. */
export async function setMainUiLanguage(_language: UiLanguage): Promise<string> {
  if (mainI18n.language !== DEFAULT_UI_LOCALE) {
    await mainI18n.changeLanguage(DEFAULT_UI_LOCALE)
  }
  return DEFAULT_UI_LOCALE
}

/** Startup dialogs use English before persisted settings are read. */
export async function prepareEarlyMainUiLanguage(): Promise<void> {
  try {
    await setMainUiLanguage('en')
  } catch (error) {
    console.warn('[i18n] Could not prepare English startup dialogs:', error)
  }
}
