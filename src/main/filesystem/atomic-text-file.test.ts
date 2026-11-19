import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { writeTextFileAtomically } from './atomic-text-file'

it('replaces a file with complete text and leaves no temp file after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ash-atomic-text-'))
  try {
    const cache = join(directory, 'cache.json')
    const blocked = join(directory, 'blocked.json')
    await writeTextFileAtomically(cache, '{}', { mode: 0o600 })
    await writeTextFileAtomically(cache, '{"updated":true}', { mode: 0o600 })
    expect(await readFile(cache, 'utf8')).toBe('{"updated":true}')
    if (process.platform !== 'win32') {
      expect((await stat(cache)).mode & 0o777).toBe(0o600)
    }

    await mkdir(blocked)
    await expect(writeTextFileAtomically(blocked, '{}')).rejects.toThrow()
    expect((await readdir(directory)).sort()).toEqual(['blocked.json', 'cache.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
