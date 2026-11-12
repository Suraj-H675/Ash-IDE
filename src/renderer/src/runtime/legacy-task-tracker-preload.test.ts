import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withFallback } from '../web/preload-api/web-fallback-api'
import { requireLegacyJiraApi, requireLegacyLinearApi } from './legacy-task-tracker-preload'

describe('Ash excluded Jira and Linear application connectors', () => {
  it('removes the privileged desktop preload imports, exports, and IPC bridge sources', () => {
    const root = process.cwd()
    const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
    const types = readFileSync(resolve(root, 'src/preload/api-types.ts'), 'utf8')
    for (const name of ['jira', 'linear']) {
      expect(preload).not.toMatch(new RegExp(`['"](?:\\./api/)?${name}-bridge['"]`))
      expect(preload).not.toMatch(new RegExp(`\\b${name}:`))
      expect(types).not.toMatch(new RegExp(`\\b${name}:`))
      expect(existsSync(resolve(root, `src/preload/api/${name}-bridge.ts`))).toBe(false)
    }
    expect(preload).toContain('gh: ghApi')
    expect(preload).toContain('gl: glApiBridge')
  })

  it('refuses historical local call sites before they can dispatch removed IPC', () => {
    expect(() => requireLegacyJiraApi()).toThrow('Jira application connector is excluded')
    expect(() => requireLegacyLinearApi()).toThrow('Linear application connector is excluded')
  })

  it('does not synthesize excluded connectors through the legacy web-client fallback', () => {
    const api = withFallback({ gh: { supported: true } }, [])
    // The archived web fallback deliberately produces callables for other unknown
    // methods. These removed connector namespaces must never receive those stubs.
    // oxlint-disable-next-line anti-slop/no-reflect-get -- Dynamic property reads verify a deleted namespace, not a typed property.
    expect(Reflect.get(api, 'jira')).toBeUndefined()
    // oxlint-disable-next-line anti-slop/no-reflect-get -- Dynamic property reads verify a deleted namespace, not a typed property.
    expect(Reflect.get(api, 'linear')).toBeUndefined()
    expect(api.gh.supported).toBe(true)
  })

  it('keeps legacy renderer modules from reaching a deleted window.api connector namespace', () => {
    const root = resolve(process.cwd(), 'src/renderer/src/runtime')
    const filenames = [
      'runtime-jira-client.ts',
      'runtime-jira-detail-client.ts',
      'runtime-jira-favourite-filters-client.ts',
      'runtime-jira-project-client.ts',
      'runtime-jira-summary-client.ts',
      'runtime-jira-summary-generation-client.ts',
      'runtime-jira-user-fields-client.ts',
      'local-jira-search-cancellation.ts',
      'runtime-linear-client.ts',
      'runtime-linear-issue-mutations.ts',
      'runtime-linear-project-client.ts'
    ]
    for (const filename of filenames) {
      const source = readFileSync(resolve(root, filename), 'utf8')
      expect(source, filename).not.toMatch(/window\.api\.(?:jira|linear)\b/)
      expect(source, filename).toContain('legacy-task-tracker-preload')
    }
  })
})
