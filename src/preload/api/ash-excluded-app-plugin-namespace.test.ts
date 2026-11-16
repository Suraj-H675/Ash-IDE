import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withFallback } from '../../renderer/src/web/preload-api/web-fallback-api'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash excluded application-plugin preload namespace', () => {
  it('does not expose the plugin IPC bridge from the real Electron preload', () => {
    const entry = source('src/preload/index.ts')
    expect(entry).not.toMatch(/import\s+\{\s*pluginsApi\s*\}/)
    expect(entry).not.toMatch(/^\s*plugins:\s*pluginsApi\s*,?\s*$/m)
    expect(entry).toContain('browser: browserApi')
    expect(entry).toContain('skills: skillsApi')
    expect(entry).toContain('pty: ptyApi')
  })

  it('does not synthesize a plugin API in a web renderer missing that namespace', () => {
    const browser = { listProfiles: () => Promise.resolve([]) }
    const skills = { listInstalled: () => Promise.resolve([]) }
    const api = withFallback({ browser, skills }, [])
    expect('plugins' in api).toBe(false)
    expect(Reflect.get(api, 'plugins')).toBeUndefined()
    expect(api.browser).toBeDefined()
    expect(api.skills).toBeDefined()
  })

  it('does not install a web plugin API stub on application startup', () => {
    const entry = source('src/renderer/src/web/web-preload-api.ts')
    expect(entry).not.toMatch(/createWebPluginsApi|plugins:\s*createWebPluginsApi/)
    expect(entry).toContain('browser: createBrowserApi()')
    expect(entry).toContain('hooks: createHooksApi()')
    expect(entry).toContain('nativeChat: createWebNativeChatApi()')
  })

  it('has no retired plugin IPC transport or web plugin namespace implementation to ship', () => {
    for (const path of [
      'src/preload/api/plugins-bridge.ts',
      'src/preload/api/plugin-panel-push-bridge.ts',
      'src/renderer/src/web/preload-api/web-plugins-api.ts',
      'src/renderer/src/components/right-sidebar/plugin-panels/PluginPanel.fixture.tsx'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
  })
})
