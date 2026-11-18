import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash excludes application-plugin language-pack backend', () => {
  it('removes language-pack contribution points and registries', () => {
    expect(source('src/shared/plugins/contributions/plugin-contribution-points.ts')).not.toContain(
      'languagePacks'
    )
    expect(source('src/shared/plugins/contributions/plugin-contribution-summary.ts')).not.toContain(
      'languagePacks'
    )
    expect(
      source('src/shared/plugins/manifest/plugin-manifest-contribution-validation.ts')
    ).not.toContain('languagePacks')
    expect(source('src/main/plugins/contributions/plugin-content-pack-registry.ts')).not.toContain(
      'languagePacks'
    )
    expect(source('src/main/plugins/plugin-artifact-validation.ts')).not.toContain(
      'PLUGIN_LANGUAGE_PACK_MAX_BYTES'
    )
  })

  it('removes language-pack parsing, coverage, authoring, and preload types', () => {
    for (const path of [
      'src/main/plugins/contributions/plugin-language-pack-registry.ts',
      'src/shared/plugins/artifacts/plugin-language-pack-artifact.ts',
      'src/shared/plugins/languages/plugin-language-pack-coverage.ts',
      'src/shared/plugins/languages/plugin-translatable-chrome.ts',
      'src/shared/plugins/languages/plugin-translation-string-policy.ts',
      'src/shared/plugins/languages/plugin-protected-copy.ts',
      'src/shared/plugins/authoring/plugin-strict-artifact-checks.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
    expect(source('src/preload/api/plugin-host-api.ts')).not.toContain('listLanguagePacks')
    expect(source('src/preload/api/plugin-host-api.ts')).not.toContain(
      'PluginLanguagePackRegistration'
    )
  })
})
