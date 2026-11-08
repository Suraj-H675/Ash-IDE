import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ashProviderFileSha256,
  heldPathForAshProviderSwap,
  readAshClaudeSettingsSnapshot,
  stagedPathForAshProviderSwap,
  swapAshClaudeSettingsIfUnchanged
} from './ash-provider-json-guard'
import { recoverAshClaudeSettingsSwap } from './ash-provider-json-recovery'

let root = ''
let configPath = ''
let original = ''
let next = ''
let id = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-provider-cas-fixture-'))
  const provider = join(root, 'provider')
  mkdirSync(provider, { mode: 0o700 })
  configPath = join(provider, 'settings.json')
  original = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'orca-hook.sh' }] }] }, data: 'foreign' }, null, 2)}\n`
  next = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'orca-hook.sh' }] }, { hooks: [{ type: 'command', command: 'ash-hook.sh' }] }] }, data: 'foreign' }, null, 2)}\n`
  writeFileSync(configPath, original, { mode: 0o600 })
  id = randomUUID()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const swap = (expectedRaw: string | null = original, nextRaw = next) =>
  swapAshClaudeSettingsIfUnchanged({ configPath, operationId: id, expectedRaw, nextRaw })
const recover = () =>
  recoverAshClaudeSettingsSwap({
    configPath,
    operationId: id,
    beforeSha256: ashProviderFileSha256(original),
    afterSha256: ashProviderFileSha256(next)!
  })

describe.skipIf(process.platform === 'win32')(
  'isolated POSIX Claude provider settings guard',
  () => {
    it('publishes a replacement without losing foreign entries, original mode or leaving guard files', async () => {
      await swap()
      expect(readFileSync(configPath, 'utf8')).toBe(next)
      expect(lstatSync(configPath).mode & 0o777).toBe(0o600)
      expect(existsSync(heldPathForAshProviderSwap(configPath, id))).toBe(false)
      expect(existsSync(`${configPath}.ash-ide-write.lock`)).toBe(false)
      expect((await readAshClaudeSettingsSnapshot(configPath))?.config.data).toBe('foreign')
    })

    it('rejects a stale expected snapshot instead of overwriting external edits', async () => {
      const external = original.replace('foreign', 'modified by another app')
      writeFileSync(configPath, external)
      await expect(swap()).rejects.toThrow('changed since plan creation')
      expect(readFileSync(configPath, 'utf8')).toBe(external)
      expect(existsSync(`${configPath}.ash-ide-write.lock`)).toBe(false)
    })

    it('refuses an existing Ash writer lock and preserves its contents', async () => {
      const lock = `${configPath}.ash-ide-write.lock`
      writeFileSync(lock, 'other Ash writer', { flag: 'wx', mode: 0o600 })
      await expect(swap()).rejects.toThrow('locked by another Ash writer')
      expect(readFileSync(lock, 'utf8')).toBe('other Ash writer')
      expect(readFileSync(configPath, 'utf8')).toBe(original)
    })

    it('refuses a symlinked provider file and a hardlinked settings inode', async () => {
      const actual = join(root, 'original.json')
      renameSync(configPath, actual)
      symlinkSync(actual, configPath)
      await expect(swap()).rejects.toThrow('symlinked, linked or not regular')
      expect(readFileSync(actual, 'utf8')).toBe(original)
      rmSync(configPath)
      linkSync(actual, configPath)
      await expect(swap()).rejects.toThrow('symlinked, linked or not regular')
      expect(readFileSync(actual, 'utf8')).toBe(original)
    })

    it('rejects a symlink in an ancestor directory before reading or publishing settings', async () => {
      const foreignHome = join(root, 'foreign-home')
      const nested = join(foreignHome, 'nested')
      mkdirSync(foreignHome, { mode: 0o700 })
      mkdirSync(nested, { mode: 0o700 })
      const foreignSettings = join(nested, 'settings.json')
      writeFileSync(foreignSettings, original, { mode: 0o600 })
      symlinkSync(foreignHome, join(root, 'provider-alias'), 'dir')
      const aliasedSettings = join(root, 'provider-alias', 'nested', 'settings.json')

      await expect(readAshClaudeSettingsSnapshot(aliasedSettings)).rejects.toThrow(
        'symlinked ancestor'
      )
      await expect(
        swapAshClaudeSettingsIfUnchanged({
          configPath: aliasedSettings,
          operationId: id,
          expectedRaw: original,
          nextRaw: next
        })
      ).rejects.toThrow('symlinked ancestor')
      expect(readFileSync(foreignSettings, 'utf8')).toBe(original)
      expect(existsSync(`${foreignSettings}.ash-ide-write.lock`)).toBe(false)
    })

    it('rejects ancestor symlinks before interrupted-swap recovery', async () => {
      const foreignHome = join(root, 'foreign-home')
      const nested = join(foreignHome, 'nested')
      mkdirSync(foreignHome, { mode: 0o700 })
      mkdirSync(nested, { mode: 0o700 })
      const foreignSettings = join(nested, 'settings.json')
      writeFileSync(foreignSettings, original, { mode: 0o600 })
      symlinkSync(foreignHome, join(root, 'provider-alias'), 'dir')
      const aliasedSettings = join(root, 'provider-alias', 'nested', 'settings.json')

      await expect(
        recoverAshClaudeSettingsSwap({
          configPath: aliasedSettings,
          operationId: id,
          beforeSha256: ashProviderFileSha256(original),
          afterSha256: ashProviderFileSha256(next)!
        })
      ).rejects.toThrow('symlinked ancestor')
      expect(readFileSync(foreignSettings, 'utf8')).toBe(original)
    })

    it('rejects malformed provider JSON and an unsupported target outside settings.json', async () => {
      writeFileSync(configPath, '{ invalid')
      await expect(swap('{ invalid')).rejects.toThrow('not valid JSON configuration')
      await expect(readAshClaudeSettingsSnapshot(join(root, 'other.json'))).rejects.toThrow(
        'unsafe POSIX Claude settings target'
      )
    })

    it('can create a previously absent provider settings file only when still absent', async () => {
      rmSync(configPath)
      await swap(null)
      expect(readFileSync(configPath, 'utf8')).toBe(next)
      expect(lstatSync(configPath).mode & 0o777).toBe(0o600)
      await expect(swap(null)).rejects.toThrow('changed since plan creation')
      expect(readFileSync(configPath, 'utf8')).toBe(next)
    })

    it('restores an interrupted held file without overwriting newer data', async () => {
      const held = heldPathForAshProviderSwap(configPath, id)
      renameSync(configPath, held) // simulate termination after original rename, before link publication
      expect(existsSync(configPath)).toBe(false)
      await expect(recover()).resolves.toBe('restored')
      expect(readFileSync(configPath, 'utf8')).toBe(original)
      expect(existsSync(held)).toBe(false)
    })

    it('recognizes a published replacement after a crash and removes the held original only', async () => {
      const held = heldPathForAshProviderSwap(configPath, id)
      renameSync(configPath, held)
      writeFileSync(configPath, next, { mode: 0o600 })
      await expect(recover()).resolves.toBe('published')
      expect(readFileSync(configPath, 'utf8')).toBe(next)
      expect(existsSync(held)).toBe(false)
    })

    it('never destroys a third-party update made after the interrupted publication', async () => {
      const held = heldPathForAshProviderSwap(configPath, id)
      renameSync(configPath, held)
      const foreign = next.replace('foreign', 'new foreign change')
      writeFileSync(configPath, foreign)
      await expect(recover()).rejects.toThrow('changed after interrupted swap')
      expect(readFileSync(configPath, 'utf8')).toBe(foreign)
      expect(readFileSync(held, 'utf8')).toBe(original)
    })

    it('does not delete an unrecognized held config or accept an unknown current version', async () => {
      const held = heldPathForAshProviderSwap(configPath, id)
      renameSync(configPath, held)
      writeFileSync(held, original.replace('foreign', 'tampered'))
      await expect(recover()).rejects.toThrow('held provider configuration has changed')
      expect(existsSync(configPath)).toBe(false)
      expect(existsSync(held)).toBe(true)
      rmSync(held)
      writeFileSync(configPath, ' { "unknown": 1 } \n')
      await expect(recover()).rejects.toThrow('does not match transaction receipt')
    })

    it('does not delete a stage file created by an interrupted earlier writer', async () => {
      const stage = stagedPathForAshProviderSwap(configPath, id)
      writeFileSync(stage, next, { flag: 'wx', mode: 0o600 })
      await expect(swap()).rejects.toThrow()
      expect(readFileSync(stage, 'utf8')).toBe(next)
      expect(readFileSync(configPath, 'utf8')).toBe(original)
    })

    it('recovers an interrupted publication whose stage and target are still hardlinked', async () => {
      const held = heldPathForAshProviderSwap(configPath, id)
      const stage = stagedPathForAshProviderSwap(configPath, id)
      renameSync(configPath, held)
      writeFileSync(stage, next, { mode: 0o600 })
      linkSync(stage, configPath)
      expect(lstatSync(configPath).nlink).toBe(2)
      await expect(recover()).resolves.toBe('published')
      expect(lstatSync(configPath).nlink).toBe(1)
      expect(existsSync(stage)).toBe(false)
      expect(existsSync(held)).toBe(false)
      expect(readFileSync(configPath, 'utf8')).toBe(next)
    })
  }
)
