import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AshClaudeSessionSettingsConflict,
  buildAshClaudeSessionSettings,
  claudeArgsWithAshSessionSettings,
  createAshClaudeSessionSettings,
  verifyAshClaudeSessionSettings
} from './ash-claude-session-settings'

let root = '',
  ash = '',
  external = '',
  workspace = ''
const hooks = [
  { event: 'SessionStart' as const, scriptPath: '/Ash IDE/hooks/start.sh' },
  { event: 'Stop' as const, scriptPath: "/Ash IDE/hooks/stop's.sh", timeoutSeconds: 3 }
]
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-session-overlay-'))
  ash = join(root, 'ash-private')
  external = join(root, 'claude-external')
  workspace = join(root, 'workspace')
  for (const p of [ash, external, workspace]) {
    mkdirSync(p, { mode: 0o700 })
  }
  writeFileSync(
    join(external, 'settings.json'),
    '{"hooks":{"Stop":[{"hooks":[{"command":"orca-existing.sh"}]}]}}\n',
    { mode: 0o600 }
  )
  writeFileSync(join(workspace, 'README.md'), 'unrelated workspace', { mode: 0o600 })
})
afterEach(() => {
  if (root) {
    rmSync(root, { force: true, recursive: true })
  }
})

const create = (sessionId: string = randomUUID()) =>
  createAshClaudeSessionSettings({ ashUserData: ash, sessionId, hooks })
describe.skipIf(process.platform === 'win32')(
  'Claude per-session settings overlay never edits shared provider settings',
  () => {
    it('creates a private Ash-only overlay with a correct Claude argv pair', async () => {
      const existing = readFileSync(join(external, 'settings.json'), 'utf8')
      const record = await create()
      expect(record.settingsArgs).toEqual(['--settings', record.settingsPath])
      expect(lstatSync(join(ash, 'provider-session-settings')).mode & 0o777).toBe(0o700)
      expect(lstatSync(record.settingsPath).mode & 0o777).toBe(0o600)
      const parsed = JSON.parse(readFileSync(record.settingsPath, 'utf8'))
      expect(parsed.hooks.SessionStart[0].hooks[0]).toEqual({
        type: 'command',
        command: "'/Ash IDE/hooks/start.sh'",
        timeout: 2
      })
      expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
        type: 'command',
        command: "'/Ash IDE/hooks/stop'\\''s.sh'",
        timeout: 3
      })
      await expect(verifyAshClaudeSessionSettings(ash, record)).resolves.toBeUndefined()
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(existing)
      expect(readFileSync(join(workspace, 'README.md'), 'utf8')).toBe('unrelated workspace')
    })
    it('does not overwrite the first settings on duplicate session IDs and leaves no stage', async () => {
      const id = randomUUID(),
        record = await create(id),
        raw = readFileSync(record.settingsPath, 'utf8')
      await expect(create(id)).rejects.toThrow('already exist')
      expect(readFileSync(record.settingsPath, 'utf8')).toBe(raw)
      expect(existsSync(`${record.settingsPath}.stage`)).toBe(false)
      await expect(verifyAshClaudeSessionSettings(ash, record)).resolves.toBeUndefined()
    })
    it('isolates different sessions', async () => {
      const a = await create(),
        b = await create()
      expect(a.settingsPath).not.toBe(b.settingsPath)
      await verifyAshClaudeSessionSettings(ash, a)
      await verifyAshClaudeSessionSettings(ash, b)
    })
    it('preserves caller CLI args and refuses an existing --settings option', async () => {
      const record = await create()
      const args = ['--model', 'opus', '--resume', 'abc']
      expect(claudeArgsWithAshSessionSettings(args, record)).toEqual([
        '--settings',
        record.settingsPath,
        ...args
      ])
      expect(args).toEqual(['--model', 'opus', '--resume', 'abc'])
      for (const bad of [['--settings', '/foreign.json'], ['--settings={"hooks":{}}']]) {
        expect(() => claudeArgsWithAshSessionSettings(bad, record)).toThrow(
          'caller already provides'
        )
      }
    })
    it('rejects invalid commands/events, duplicate hook events and invalid timeout', () => {
      for (const input of [
        [{ event: 'Stop', scriptPath: 'relative.sh' }],
        [{ event: 'Stop', scriptPath: '/usr/bin/a\nsh' }],
        [{ event: 'PreToolUse', scriptPath: '/trusted.sh' }],
        [{ event: 'Stop', scriptPath: '/trusted.sh', timeoutSeconds: 0 }],
        [
          { event: 'Stop', scriptPath: '/trusted.sh' },
          { event: 'Stop', scriptPath: '/trusted2.sh' }
        ],
        [{ event: 'Stop', scriptPath: `/${'x'.repeat(5000)}` }]
      ]) {
        expect(() => buildAshClaudeSessionSettings(input as never)).toThrow(
          AshClaudeSessionSettingsConflict
        )
      }
      expect(() => buildAshClaudeSessionSettings([])).toThrow('invalid number')
    })
    it('detects tampered settings before launch', async () => {
      const record = await create()
      writeFileSync(record.settingsPath, '{"hooks":{}}\n')
      await expect(verifyAshClaudeSessionSettings(ash, record)).rejects.toThrow(
        'changed after preparation'
      )
    })
    it('rejects symlinked overlay directory without writing through it', async () => {
      symlinkSync(external, join(ash, 'provider-session-settings'), 'dir')
      await expect(create()).rejects.toThrow('not real')
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toContain('orca-existing.sh')
    })
    it('refuses world-readable existing directory without silently chmodding', async () => {
      const dir = join(ash, 'provider-session-settings')
      mkdirSync(dir, { mode: 0o755 })
      await expect(create()).rejects.toThrow('not private')
      expect(lstatSync(dir).mode & 0o777).toBe(0o755)
    })
    it('refuses insecure profile roots and symlinked ancestors', async () => {
      chmodSync(ash, 0o755)
      await expect(create()).rejects.toThrow('not private')
      chmodSync(ash, 0o700)
      const alias = join(root, 'alias')
      symlinkSync(ash, alias, 'dir')
      await expect(
        createAshClaudeSessionSettings({ ashUserData: alias, sessionId: randomUUID(), hooks })
      ).rejects.toThrow('contains a symlink')
    })
    it('rejects verification outside its originating Ash profile', async () => {
      const record = await create()
      await expect(verifyAshClaudeSessionSettings(external, record)).rejects.toThrow(
        'not this Ash session'
      )
      await expect(
        verifyAshClaudeSessionSettings(ash, {
          ...record,
          settingsPath: join(external, 'settings.json')
        })
      ).rejects.toThrow('not this Ash session')
    })
    it('refuses malformed session identities before any disk write', async () => {
      await expect(create('..')).rejects.toThrow('session id is not a UUIDv4')
      expect(existsSync(join(ash, 'provider-session-settings'))).toBe(false)
    })
  }
)
