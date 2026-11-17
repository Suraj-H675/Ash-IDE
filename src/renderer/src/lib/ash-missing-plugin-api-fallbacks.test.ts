// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installApi } from '../web/web-preload-api-test-harness'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Ash excluded application-plugin API fallbacks', () => {
  it('removes the temporary renderer compatibility facade', () => {
    expect(
      existsSync(resolve(process.cwd(), 'src/renderer/src/lib/legacy-app-plugins-api.ts'))
    ).toBe(false)
  })

  it('does not expose a plugins namespace from the Electron preload API', () => {
    const electronPreload = source('src/preload/index.ts')
    const apiObject = electronPreload.match(
      /const api = \{([\s\S]*?)\}\s+satisfies PreloadApi/
    )?.[1]

    expect(apiObject).toBeDefined()
    expect(apiObject).not.toMatch(/^\s*plugins\s*:/m)
    expect(electronPreload).toContain("contextBridge.exposeInMainWorld('api', api)")
  })

  it('does not expose a plugins namespace from the installed web preload API', async () => {
    const { api } = await installApi()

    expect('plugins' in api).toBe(false)
    expect(Reflect.get(api, 'plugins')).toBeUndefined()
    expect(api.browser).toBeDefined()
    expect(api.skills).toBeDefined()
  })
})
