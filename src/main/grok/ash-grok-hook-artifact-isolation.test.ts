import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSharedManagedScriptPath } from '../agent-hooks/installer-utils'
import {
  hasLivePeer,
  registerGrokHookOwner,
  releaseGrokHookOwnerAndCheckForPeers,
  unregisterGrokHookOwnerSync
} from './grok-hook-owners'
import { GROK_EVENTS } from './grok-hook-config'
import { getGrokManagedCommand } from './grok-hook-script'
import { GrokHookService } from './hook-service'

let home = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ash-grok-artifact-isolation-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('GROK_HOME', join(home, 'disposable-grok-home'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

describe('Ash-managed provider hook artifacts do not share Orca-owned paths', () => {
  it('uses an Ash-only script root without reading or creating Orca hook scripts', () => {
    const orca = join(home, '.orca', 'agent-hooks')
    mkdirSync(orca, { recursive: true })
    const sentinel = join(orca, 'grok-hook.sh')
    writeFileSync(sentinel, '# Orca-owned\n')
    const resolved = getSharedManagedScriptPath('grok-hook.sh')
    expect(resolved).toBe(join(home, '.ash-ide', 'agent-hooks', 'grok-hook.sh'))
    expect(existsSync(resolved)).toBe(false)
    expect(readFileSync(sentinel, 'utf8')).toBe('# Orca-owned\n')
  })

  it('rejects traversal and an Ash script directory redirected into Orca', () => {
    expect(() => getSharedManagedScriptPath('../escape.sh')).toThrow()
    expect(() => getSharedManagedScriptPath('nested/grok-hook.sh')).toThrow()
    const orca = join(home, '.orca', 'agent-hooks')
    mkdirSync(orca, { recursive: true })
    const ashRoot = join(home, '.ash-ide')
    mkdirSync(ashRoot)
    symlinkSync(orca, join(ashRoot, 'agent-hooks'), 'dir')
    expect(() => getSharedManagedScriptPath('grok-hook.sh')).toThrow()
    expect(existsSync(join(orca, 'grok-hook.sh'))).toBe(false)
  })

  it('refuses a hard-linked foreign script before a status or refresh can use it', async () => {
    const foreignDir = join(home, '.orca', 'agent-hooks')
    mkdirSync(foreignDir, { recursive: true })
    const foreign = join(foreignDir, 'grok-hook.sh')
    writeFileSync(foreign, '# foreign script, do not rewrite\n')
    const ashDir = join(home, '.ash-ide', 'agent-hooks')
    mkdirSync(ashDir, { recursive: true, mode: 0o700 })
    linkSync(foreign, join(ashDir, 'grok-hook.sh'))
    expect(() => getSharedManagedScriptPath('grok-hook.sh')).toThrow(
      'ash_managed_hook_file_not_private'
    )
    await new GrokHookService().refreshManagedScripts()
    expect(readFileSync(foreign, 'utf8')).toBe('# foreign script, do not rewrite\n')
  })

  it('keeps Grok ownership records inside Ash and leaves Orca owner records untouched', async () => {
    const foreign = join(home, '.orca', 'agent-hooks', 'grok-owners')
    mkdirSync(foreign, { recursive: true })
    const foreignRecord = join(foreign, 'owner-11111111-1111-4111-8111-111111111111.json')
    writeFileSync(foreignRecord, '{"foreign":"sentinel"}\n')
    registerGrokHookOwner()
    const ash = join(home, '.ash-ide', 'agent-hooks', 'grok-owners')
    expect(readdirSync(ash)).toHaveLength(1)
    expect(await releaseGrokHookOwnerAndCheckForPeers()).toBe(false)
    expect(readdirSync(ash)).toHaveLength(0)
    expect(readFileSync(foreignRecord, 'utf8')).toBe('{"foreign":"sentinel"}\n')
    unregisterGrokHookOwnerSync()
    expect(readFileSync(foreignRecord, 'utf8')).toBe('{"foreign":"sentinel"}\n')
  })

  it('accepts only its own existing owner token, never an occupied foreign record', () => {
    registerGrokHookOwner()
    const directory = join(home, '.ash-ide', 'agent-hooks', 'grok-owners')
    const [file] = readdirSync(directory)
    // Repeated registration of this same process remains idempotent.
    registerGrokHookOwner()
    expect(readdirSync(directory)).toEqual([file])
    writeFileSync(join(directory, file), '{"owner":"other-process"}\n')
    expect(() => registerGrokHookOwner()).toThrow('ash_grok_owner_record_not_ours')
    expect(readFileSync(join(directory, file), 'utf8')).toBe('{"owner":"other-process"}\n')
  })

  it('rejects an owner-registry directory symlinked into another application', () => {
    const orca = join(home, '.orca', 'agent-hooks', 'grok-owners')
    mkdirSync(orca, { recursive: true })
    const ash = join(home, '.ash-ide', 'agent-hooks')
    mkdirSync(ash, { recursive: true })
    symlinkSync(orca, join(ash, 'grok-owners'), 'dir')
    expect(() => registerGrokHookOwner()).toThrow('ash_secret_key_path_escapes_profile')
    expect(readdirSync(orca)).toEqual([])
  })

  it('never prunes an unknown or dead peer record from any owner directory', async () => {
    const registry = join(home, 'owner-records')
    mkdirSync(registry)
    const invalid = join(registry, 'owner-22222222-2222-4222-8222-222222222222.json')
    writeFileSync(invalid, 'not-valid-json')
    expect(
      await hasLivePeer(registry, '11111111-1111-4111-8111-111111111111', async () => false)
    ).toBe(true)
    expect(readFileSync(invalid, 'utf8')).toBe('not-valid-json')
  })

  it('does not prune a syntactically valid but dead owner record', async () => {
    const registry = join(home, 'owner-records')
    mkdirSync(registry)
    const token = '33333333-3333-4333-8333-333333333333'
    const file = join(registry, `owner-${token}.json`)
    const raw = `${JSON.stringify({ token, pid: 99999 })}\n`
    writeFileSync(file, raw)
    expect(
      await hasLivePeer(registry, '11111111-1111-4111-8111-111111111111', async () => false)
    ).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(raw)
  })

  it('does not recognize Orca-owned Grok hook commands as Ash installations', () => {
    const grok = join(home, 'disposable-grok-home', 'hooks')
    mkdirSync(grok, { recursive: true })
    const oldCommand = getGrokManagedCommand(join(home, '.orca', 'agent-hooks', 'grok-hook.sh'))
    const foreign = join(grok, 'orca-status.json')
    const raw = `${JSON.stringify({
      hooks: Object.fromEntries(
        GROK_EVENTS.map((event) => [
          event.eventName,
          [{ hooks: [{ type: 'command', command: oldCommand }] }]
        ])
      )
    })}\n`
    writeFileSync(foreign, raw)
    const current = new GrokHookService().getStatus()
    expect(current).toMatchObject({ state: 'not_installed', managedHooksPresent: false })
    expect(readFileSync(foreign, 'utf8')).toBe(raw)
  })

  it('blocks direct Grok install and removal without opening its provider settings', async () => {
    const service = new GrokHookService()
    expect(service.install({ userInitiated: true })).toMatchObject({
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    expect(service.remove()).toMatchObject({
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    await expect(service.removeAsync()).resolves.toMatchObject({
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    await expect(
      service.installRemote({} as never, '/synthetic', '/synthetic')
    ).resolves.toMatchObject({
      state: 'skipped',
      skipReason: 'ash_ownership_unavailable'
    })
    expect(existsSync(join(home, '.orca'))).toBe(false)
    expect(existsSync(join(home, 'disposable-grok-home'))).toBe(false)
  })
})
