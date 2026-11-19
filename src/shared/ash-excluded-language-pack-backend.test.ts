import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps the general application-plugin language-pack host and preload contracts absent', () => {
  for (const path of [
    'src/main/plugins',
    'src/shared/plugins',
    'src/preload/api/plugin-host-api.ts',
    'src/renderer/src/store/plugin-language-packs.ts'
  ]) {
    expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
  }
})
