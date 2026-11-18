import type { TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import enRuntimeRequired from './en-runtime-required.json'
import {
  advanceTranslationResourceVersion,
  getTranslationResourceVersion
} from './translation-resource-version'
import { createOrcaI18n } from '../../../shared/orca-i18n-instance'

const orcaI18n = createOrcaI18n({
  // Inline defaults cover English while en.json remains the complete translator source catalog.
  englishResources: enRuntimeRequired,
  modules: [initReactI18next],
  initOptions: { react: { useSuspense: false } }
})

export const i18n = orcaI18n.i18n

// Plugin packs can replace translations without changing the active language.
i18n.store.on('added', advanceTranslationResourceVersion)
i18n.store.on('removed', advanceTranslationResourceVersion)
i18n.on('languageChanged', advanceTranslationResourceVersion)

// Re-rendered chrome resolves hundreds of option-free strings per workspace switch; they only change with language or resources.
const PLAIN_TRANSLATION_CACHE_LIMIT = 5000
const plainTranslationCache = new Map<string, string>()
let plainTranslationCacheScope = ''

export function translate(key: string, fallback: string, options?: TOptions): string {
  if (options !== undefined) {
    return orcaI18n.translate(key, fallback, options)
  }
  const scope = `${i18n.isInitialized}\0${i18n.language}\0${getTranslationResourceVersion()}`
  if (
    scope !== plainTranslationCacheScope ||
    plainTranslationCache.size >= PLAIN_TRANSLATION_CACHE_LIMIT
  ) {
    plainTranslationCache.clear()
    plainTranslationCacheScope = scope
  }
  const cacheKey = `${key}\0${fallback}`
  const cached = plainTranslationCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }
  const value = orcaI18n.translate(key, fallback)
  plainTranslationCache.set(cacheKey, value)
  return value
}

/** Renderer date, number, and list formatting follows the English-only UI. */
export function getIntlLocale(): string {
  return 'en'
}
