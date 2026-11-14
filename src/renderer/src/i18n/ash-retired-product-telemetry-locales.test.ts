import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const retiredProductTelemetryKeys = [
  'auto.hooks.useSettingsNavigationMetadata.8400cfe1c1',
  'auto.hooks.useSettingsNavigationMetadata.3618579df6',
  'auto.components.FirstLaunchBanner',
  'auto.components.settings.PrivacyPane',
  'auto.components.settings.Settings.c1b43dc4e2',
  'auto.components.settings.Settings.d7e3f62d70',
  'auto.components.settings.privacy.search.69637f4dc4',
  'auto.components.settings.privacy.search.f7a2d9f137',
  'auto.components.settings.privacy.search.e058a3c98d',
  'auto.components.settings.privacy.search.27a27b2f63',
  'auto.components.settings.privacy.search.4d4bb76bf4',
  'auto.components.settings.privacy.search.77d3180def',
  'auto.components.settings.privacy.search.57b283461a',
  'auto.components.settings.privacy.search.2b5a5c312f',
  'auto.components.settings.privacy.search.b021b9cb81',
  'auto.components.settings.privacy.search.79c319948b',
  'auto.components.settings.privacy.search.b707cc3981',
  'auto.components.settings.privacy.search.4104f6f0f3',
  'auto.components.settings.privacy.search.aa3b794c17',
  'auto.components.settings.privacy.search.5c508bad41',
  'auto.components.settings.PrivacyDiagnosticsRows.63d03261d1'
] as const

function getKey(root: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    return (value as Record<string, unknown>)[segment]
  }, root)
}

describe('Ash ships no retired product-telemetry consent translations', () => {
  it('excludes retired product telemetry UI keys in all desktop locale assets', () => {
    const root = resolve(process.cwd(), 'src/renderer/src/i18n/locales')
    const locales = readdirSync(root)
      .filter((name) => name.endsWith('.json'))
      .sort()
    expect(locales).toEqual([
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'ja.json',
      'ko.json',
      'pt.json',
      'ru.json',
      'tr.json',
      'zh-Hant.json',
      'zh.json'
    ])

    for (const locale of locales) {
      const catalog = JSON.parse(readFileSync(resolve(root, locale), 'utf8')) as unknown
      for (const key of retiredProductTelemetryKeys) {
        expect(getKey(catalog, key), `${locale}: ${key}`).toBeUndefined()
      }
      // Keep local user-controlled diagnostic workflows and local desktop controls.
      expect(getKey(catalog, 'auto.components.settings.privacy.search.c0494ff48a')).toBeDefined()
      expect(getKey(catalog, 'auto.components.settings.privacy.search.8b08f32366')).toBeDefined()
      expect(getKey(catalog, 'auto.components.settings.privacy.search.ead1deded2')).toBeDefined()
      expect(getKey(catalog, 'auto.components.settings.PrivacyDiagnosticsRows')).toBeDefined()
      expect(getKey(catalog, 'auto.components.settings.mobile.emulator')).toBeDefined()
    }
  })

  it('does not retain the removed Privacy & Telemetry label in translation overrides', () => {
    const overrides = readFileSync(
      resolve(process.cwd(), 'config/scripts/locale-catalog/locale-value-overrides.mjs'),
      'utf8'
    )
    expect(overrides).not.toContain("'Privacy & Telemetry':")
  })
})
