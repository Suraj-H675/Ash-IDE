import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyMainSandboxPreloadOutputs } from './preload-output-contract.mjs'

const roots = []
const names = [
  'browser-extension-preload.js',
  'browser-guest-preload.js',
  'doc-preview-link-preload.js'
]

async function fixture(override = {}, missing = []) {
  const root = await mkdtemp(join(tmpdir(), 'ash-main-preload-output-'))
  roots.push(root)
  const output = join(root, 'out', 'main')
  await mkdir(output, { recursive: true })
  for (const name of names) {
    if (!missing.includes(name)) {
      await writeFile(join(output, name), override[name] ?? 'const electron = require("electron")')
    }
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('final main sandbox preload outputs', () => {
  it('accepts all three self-contained browser frame preloads', async () => {
    await expect(verifyMainSandboxPreloadOutputs(await fixture())).resolves.toEqual(names)
  })

  it.each(names)('rejects a relative runtime chunk in %s', async (name) => {
    const root = await fixture({
      [name]: 'require("./chunks/rolldown-runtime-fixture.js"); require("electron")'
    })
    await expect(verifyMainSandboxPreloadOutputs(root)).rejects.toThrow(
      `Invalid sandboxed main preload ${name}: Unsupported sandbox preload imports:`
    )
  })

  it('rejects a missing extension preload instead of accepting an incomplete build', async () => {
    await expect(verifyMainSandboxPreloadOutputs(await fixture({}, [names[0]]))).rejects.toThrow(
      /ENOENT.*browser-extension-preload/
    )
  })
})
