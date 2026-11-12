import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  confirmAshClaudeHookInstall,
  emptyAshHookOwnershipLedger,
  planAshClaudeHookInstall,
  planAshClaudeHookRemoval
} from './ash-hook-ownership-plan'
import { readAshHookOwnershipLedger, saveAshHookOwnershipLedger } from './ash-hook-ownership-store'

let tmp = ''
let userData = ''
let providerConfig = ''
const source = {
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'orca-owned.sh' }] }] },
  profile: 'foreign-setting'
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ash-hook-claim-fixture-'))
  userData = join(tmp, 'ash-profile')
  mkdirSync(userData, { mode: 0o700 })
  const claudeHome = join(tmp, 'disposable-claude-home')
  mkdirSync(claudeHome, { mode: 0o700 })
  providerConfig = join(claudeHome, 'settings.json')
  writeFileSync(providerConfig, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 })
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (tmp) {
    rmSync(tmp, { force: true, recursive: true })
  }
})

const readProvider = () =>
  JSON.parse(readFileSync(providerConfig, 'utf8')) as Record<string, unknown>
const writeProvider = (config: Record<string, unknown>) =>
  writeFileSync(providerConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })

describe('private Ash ownership records with disposable provider config files', () => {
  it('refuses an Orca-owned profile root before reading or creating ownership files', async () => {
    vi.stubEnv('HOME', tmp)
    const foreign = join(tmp, '.orca')
    mkdirSync(foreign, { mode: 0o700 })
    const sentinel = join(foreign, 'foreign-app-state')
    writeFileSync(sentinel, 'do-not-inspect-or-change', { mode: 0o600 })
    await expect(readAshHookOwnershipLedger(foreign)).rejects.toThrow(
      'ash_data_root_conflicts_with_orca'
    )
    await expect(
      saveAshHookOwnershipLedger(foreign, emptyAshHookOwnershipLedger(), null)
    ).rejects.toThrow('ash_data_root_conflicts_with_orca')
    expect(existsSync(join(foreign, 'provider-hook-ownership'))).toBe(false)
    expect(readFileSync(sentinel, 'utf8')).toBe('do-not-inspect-or-change')
  })

  it('inspects a fresh Ash profile without creating a private ledger directory', async () => {
    const dir = join(userData, 'provider-hook-ownership')
    expect(existsSync(dir)).toBe(false)
    const snapshot = await readAshHookOwnershipLedger(userData)
    expect(snapshot).toEqual({ ledger: emptyAshHookOwnershipLedger(), revision: null })
    expect(existsSync(dir)).toBe(false)
    // Only an intentional write may initialize the private ledger directory.
    await saveAshHookOwnershipLedger(userData, snapshot.ledger, snapshot.revision)
    expect(existsSync(dir)).toBe(true)
  })

  it('does not open a hard-linked foreign ledger, even when the record itself is valid', async () => {
    const directory = join(userData, 'provider-hook-ownership')
    mkdirSync(directory, { mode: 0o700 })
    const foreign = join(tmp, 'foreign-claims.json')
    const original = `${JSON.stringify(emptyAshHookOwnershipLedger())}\n`
    writeFileSync(foreign, original, { mode: 0o600 })
    linkSync(foreign, join(directory, 'claims.v1.json'))
    await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow('linked')
    expect(readFileSync(foreign, 'utf8')).toBe(original)
    expect(statSync(foreign).nlink).toBe(2)
  })
  it('persists prepared -> observed -> installed -> selectively removed, preserving foreign edits', async () => {
    const empty = await readAshHookOwnershipLedger(userData)
    expect(empty.ledger).toEqual(emptyAshHookOwnershipLedger())
    expect(empty.revision).toBeNull()
    const plan = planAshClaudeHookInstall({
      ledger: empty.ledger,
      config: readProvider(),
      configPath: providerConfig,
      event: 'Stop',
      command: '/fixture/ash-owned-hook.sh'
    })
    const staged = await saveAshHookOwnershipLedger(userData, plan.ledger, empty.revision)
    expect(staged.ledger.claims[0].state).toBe('prepared')
    writeProvider(plan.config)
    const observed = confirmAshClaudeHookInstall({
      ledger: staged.ledger,
      config: readProvider(),
      configPath: providerConfig,
      id: plan.claim.id
    })
    const committed = await saveAshHookOwnershipLedger(userData, observed, staged.revision)
    expect((await readAshHookOwnershipLedger(userData)).ledger.claims[0].state).toBe('installed')
    // Simulate another app changing a distinct setting and adding its own same-event hook.
    const updated = readProvider()
    updated.profile = 'changed-by-provider'
    const hooks = (updated.hooks as Record<string, unknown[]>).Stop
    hooks.unshift({ hooks: [{ type: 'command', command: 'unknown-new-hook.sh' }] })
    writeProvider(updated)
    const removed = planAshClaudeHookRemoval({
      ledger: committed.ledger,
      config: readProvider(),
      configPath: providerConfig,
      id: plan.claim.id
    })
    writeProvider(removed.config)
    await saveAshHookOwnershipLedger(userData, removed.ledger, committed.revision)
    expect(readProvider()).toEqual({
      hooks: { Stop: [hooks[0], source.hooks.Stop[0]] },
      profile: 'changed-by-provider'
    })
    expect((await readAshHookOwnershipLedger(userData)).ledger.claims).toEqual([])
    if (process.platform !== 'win32') {
      expect(statSync(join(userData, 'provider-hook-ownership')).mode & 0o777).toBe(0o700)
      expect(
        statSync(join(userData, 'provider-hook-ownership', 'claims.v1.json')).mode & 0o777
      ).toBe(0o600)
    }
  })

  it('rejects a stale ledger revision and preserves the committed record', async () => {
    const snapshot = await readAshHookOwnershipLedger(userData)
    const persisted = await saveAshHookOwnershipLedger(userData, snapshot.ledger, snapshot.revision)
    await expect(
      saveAshHookOwnershipLedger(userData, emptyAshHookOwnershipLedger(), snapshot.revision)
    ).rejects.toThrow('changed since it was read')
    expect((await readAshHookOwnershipLedger(userData)).revision).toBe(persisted.revision)
  })

  it('refuses concurrent/stale writer locks and preserves the provider config', async () => {
    mkdirSync(join(userData, 'provider-hook-ownership'), { mode: 0o700 })
    const lock = join(userData, 'provider-hook-ownership', 'claims.lock')
    writeFileSync(lock, 'another writer', { flag: 'wx', mode: 0o600 })
    await expect(
      saveAshHookOwnershipLedger(userData, emptyAshHookOwnershipLedger(), null)
    ).rejects.toThrow('locked by another writer')
    expect(readProvider()).toEqual(source)
    expect(readFileSync(lock, 'utf8')).toBe('another writer')
  })

  it('fails closed for a symlinked ledger directory and a symlinked ledger file', async () => {
    const target = join(tmp, 'outside-dir')
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, join(userData, 'provider-hook-ownership'), 'dir')
    await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow('not a real directory')
    rmSync(join(userData, 'provider-hook-ownership'))
    mkdirSync(join(userData, 'provider-hook-ownership'), { mode: 0o700 })
    symlinkSync(providerConfig, join(userData, 'provider-hook-ownership', 'claims.v1.json'))
    await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow()
    expect(readProvider()).toEqual(source)
  })

  it('refuses malformed/corrupt on-disk records rather than resetting ownership', async () => {
    mkdirSync(join(userData, 'provider-hook-ownership'), { mode: 0o700 })
    const file = join(userData, 'provider-hook-ownership', 'claims.v1.json')
    writeFileSync(file, '{broken', { mode: 0o600 })
    await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow('unreadable JSON')
    writeFileSync(file, '{"schemaVersion": 7, "owner": "orca", "claims": []}')
    await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow('unknown, corrupt')
  })

  it('refuses world-readable ledger file and keeps its contents unchanged', async () => {
    mkdirSync(join(userData, 'provider-hook-ownership'), { mode: 0o700 })
    const file = join(userData, 'provider-hook-ownership', 'claims.v1.json')
    const raw = `${JSON.stringify(emptyAshHookOwnershipLedger())}\n`
    writeFileSync(file, raw, { mode: 0o644 })
    if (process.platform !== 'win32') {
      await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow('exposes provider')
      expect(readFileSync(file, 'utf8')).toBe(raw)
    }
  })

  it('refuses an insecure ledger directory without changing its permissions', async () => {
    const dir = join(userData, 'provider-hook-ownership')
    mkdirSync(dir, { mode: 0o755 })
    if (process.platform !== 'win32') {
      await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow(
        'accessible by other users'
      )
      expect(statSync(dir).mode & 0o777).toBe(0o755)
    }
  })

  it('refuses an insecure Ash profile root before creating ledger files', async () => {
    if (process.platform === 'win32') {
      return
    }
    chmodSync(userData, 0o755)
    await expect(readAshHookOwnershipLedger(userData)).rejects.toThrow(
      'Ash userData root is accessible by other users'
    )
    expect(statSync(userData).mode & 0o777).toBe(0o755)
  })
})
