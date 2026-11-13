import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import { CodexHookService } from './codex-hook-service-implementation'
import { exerciseLegacyCodexRemovalInDisposableFixture } from './codex-legacy-removal.test-support'

let fixture = ''
let ownScript = ''
let foreignScript = ''
let foreignCodexHooks = ''
let foreignCodexConfig = ''

beforeEach(() => {
  // /tmp can be subject to a separate per-user disk quota on Linux.
  fixture = mkdtempSync(
    join(process.platform === 'linux' ? '/var/tmp' : tmpdir(), 'ash-codex-ambient-')
  )
  vi.stubEnv('HOME', fixture)
  vi.stubEnv('ORCA_USER_DATA_PATH', join(fixture, 'ash-profile'))
  vi.stubEnv('XDG_CONFIG_HOME', join(fixture, '.config'))
  const ownRoot = join(fixture, '.ash-ide', 'agent-hooks')
  const foreignRoot = join(fixture, '.orca', 'agent-hooks')
  mkdirSync(ownRoot, { recursive: true, mode: 0o700 })
  mkdirSync(foreignRoot, { recursive: true, mode: 0o700 })
  ownScript = join(ownRoot, 'codex-hook.sh')
  foreignScript = join(foreignRoot, 'codex-hook.sh')
  writeFileSync(ownScript, '# unclaimed Ash script - do not rewrite\n', { mode: 0o600 })
  writeFileSync(foreignScript, '# Orca script - do not inspect or rewrite\n', { mode: 0o600 })
  const codex = join(fixture, '.codex')
  mkdirSync(codex, { mode: 0o700 })
  foreignCodexHooks = join(codex, 'hooks.json')
  foreignCodexConfig = join(codex, 'config.toml')
  writeFileSync(
    foreignCodexHooks,
    '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"foreign.sh"}]}]}}\n'
  )
  writeFileSync(foreignCodexConfig, 'model = "foreign-preserved"\n')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(fixture, { recursive: true, force: true })
})

function expectNoMutation(): void {
  expect(readFileSync(ownScript, 'utf8')).toBe('# unclaimed Ash script - do not rewrite\n')
  expect(readFileSync(foreignScript, 'utf8')).toBe('# Orca script - do not inspect or rewrite\n')
  expect(readFileSync(foreignCodexHooks, 'utf8')).toBe(
    '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"foreign.sh"}]}]}}\n'
  )
  expect(readFileSync(foreignCodexConfig, 'utf8')).toBe('model = "foreign-preserved"\n')
  expect(existsSync(join(fixture, 'ash-profile'))).toBe(false)
}

describe.skipIf(process.platform === 'win32')('direct Codex ambient/global hook policy', () => {
  it('does not refresh an unclaimed shared script', async () => {
    await expect(new CodexHookService().refreshManagedScripts()).resolves.toBeUndefined()
    expectNoMutation()
  })

  it('refuses startup reconciliation before writing scripts or provider settings', async () => {
    await expect(new CodexHookService().reconcileHooks()).resolves.toMatchObject({
      agent: 'codex',
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    expectNoMutation()
  })

  it('refuses direct broad-match removal before creating or changing a Codex home', async () => {
    await expect(new CodexHookService().remove()).resolves.toMatchObject({
      agent: 'codex',
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    expectNoMutation()
  })

  it('preserves unknown and name-matched hooks when direct removal is requested', async () => {
    const runtimeHome = join(fixture, 'ash-profile', 'codex-runtime-home', 'home')
    mkdirSync(runtimeHome, { recursive: true, mode: 0o700 })
    const hooks = join(runtimeHome, 'hooks.json')
    const raw = `${JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/other-app/agent-hooks/codex-hook.sh' }] },
          { hooks: [{ type: 'command', command: '/unknown/foreign-hook.sh' }] }
        ]
      }
    })}\n`
    writeFileSync(hooks, raw, { mode: 0o600 })
    await expect(new CodexHookService().remove()).resolves.toMatchObject({
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    expect(readFileSync(hooks, 'utf8')).toBe(raw)
    expect(readFileSync(foreignCodexHooks, 'utf8')).toContain('foreign.sh')
    expect(readFileSync(foreignCodexConfig, 'utf8')).toBe('model = "foreign-preserved"\n')
    expect(readFileSync(foreignScript, 'utf8')).toBe('# Orca script - do not inspect or rewrite\n')
  })

  it('refuses to run historical cleanup against a non-disposable data root', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', '/not-a-disposable-Ash-test-root')
    expect(() => exerciseLegacyCodexRemovalInDisposableFixture()).toThrow(
      'legacy_codex_removal_test_requires_disposable_data_root'
    )
    expect(readFileSync(foreignCodexConfig, 'utf8')).toBe('model = "foreign-preserved"\n')
  })

  it('refuses remote Codex hook installation without calling any SFTP method', async () => {
    const readFile = vi.fn(() => {
      throw new Error('remote SFTP read must never occur')
    })
    const writeFile = vi.fn(() => {
      throw new Error('remote SFTP write must never occur')
    })
    const sftp = { readFile, writeFile } as unknown as SFTPWrapper
    await expect(
      new CodexHookService().installRemote(sftp, '/remote/synthetic')
    ).resolves.toMatchObject({
      agent: 'codex',
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expectNoMutation()
  })

  it('retains nonmutating status inspection', () => {
    const status = new CodexHookService().getStatus(join(fixture, 'missing-runtime-home'))
    expect(status.agent).toBe('codex')
    expectNoMutation()
  })
})
