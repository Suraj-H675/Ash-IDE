import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Ash desktop excludes Jira/Linear application IPC handlers', () => {
  it('does not retain the orphaned tracker handler directories', () => {
    for (const tracker of ['jira', 'linear']) {
      expect(existsSync(resolve(process.cwd(), 'src/main/ipc', tracker)), tracker).toBe(false)
    }
  })

  it('preserves the real local runtime and browser IPC registrations', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/main/ipc/register-core-handlers/register-core-handlers.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/register(?:Jira|Linear)Handlers\s*\(/)
    expect(source).toContain('registerBrowserHandlers(store)')
    expect(source).toContain('registerRuntimeHandlers(runtime)')
    expect(source).toContain('registerSessionHandlers(store, runtime)')
  })

  it('keeps legacy credential path metadata without any automatic Orca migration', () => {
    const startup = readFileSync(
      resolve(process.cwd(), 'src/main/orcad/orcad-secret-store-startup.ts'),
      'utf8'
    )
    expect(startup).not.toContain('migratePlaintextCredentials')
    expect(
      existsSync(resolve(process.cwd(), 'src/main/orcad/orcad-plaintext-credential-migration.ts'))
    ).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/main/linear/linear-credential-paths.ts'))).toBe(
      true
    )
    expect(existsSync(resolve(process.cwd(), 'src/main/jira/site-credential-store.ts'))).toBe(true)
  })
})
