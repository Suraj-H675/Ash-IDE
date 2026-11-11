import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const retiredPhoneKeys = [
  'auto.components.mobile',
  'auto.components.settings.MobileNetworkInterfaceSection',
  'auto.components.settings.MobilePane',
  'auto.components.settings.MobileSettingsPane',
  'auto.components.settings.MobilePairingConnectionOptions',
  'auto.components.settings.MobilePairingSetupSection',
  'auto.components.settings.MobileRelayBetaNotice',
  'auto.components.settings.mobile.pane',
  'auto.components.settings.mobile.settings'
] as const

function getKey(root: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      root
    )
}

function readCatalog(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, unknown>
}

describe('Ash excludes orphaned phone UI translations without stripping desktop UI', () => {
  it('omits dead phone pages, setup and pairing Settings from every shipped locale', () => {
    const root = 'src/renderer/src/i18n/locales'
    const locales = readdirSync(resolve(process.cwd(), root))
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
      const catalog = readCatalog(`${root}/${locale}`)
      for (const key of retiredPhoneKeys) {
        expect(getKey(catalog, key), `${locale}: ${key}`).toBeUndefined()
      }
      // The Android/iOS emulator and mobile viewport sizes are legitimate desktop features.
      expect(getKey(catalog, 'auto.components.settings.mobile.emulator')).toBeDefined()
      expect(getKey(catalog, 'auto.components.settings.MobileEmulatorSettingsPane')).toBeDefined()
      expect(getKey(catalog, 'browser.viewport.mobile-s')).toBeDefined()
      // Pairing-generator fragments still exist in source; this slice cannot remove their keys.
      expect(getKey(catalog, 'auto.components.settings.RuntimePairingUrlGenerator')).toBeDefined()
    }
  })

  it('does not retain orphaned phone keys in translation override files', () => {
    const root = 'config/scripts/locale-catalog'
    const korean = readCatalog(`${root}/locale-ko-key-overrides.json`)
    for (const key of Object.keys(korean)) {
      expect(
        retiredPhoneKeys.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)),
        key
      ).toBe(false)
    }
    const overrides = readFileSync(resolve(process.cwd(), root, 'locale-key-overrides.mjs'), 'utf8')
    for (const key of retiredPhoneKeys) {
      expect(overrides.includes(`'${key}.`), key).toBe(false)
    }
  })
})
