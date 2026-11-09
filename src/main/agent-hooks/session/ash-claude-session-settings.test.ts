import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  prepareClaudeProfileDirectory
} from '../../claude-accounts/claude-profile-paths'
import type { ClaudeProfileDescriptor } from '../../claude-accounts/claude-profile-paths'
import {
  AshClaudeSessionSettingsConflict,
  buildAshClaudeSessionSettings,
  claudeArgsWithAshSessionSettings,
  claudeVerifiedArgsWithManagedAccountAshSessionSettings,
  claudeVerifiedArgsWithAshSessionSettings,
  createAshClaudeSessionSettings,
  recoverAshClaudeSessionSettingsForManagedAccount,
  recoverAshClaudeSessionSettings,
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
  root = mkdtempSync(join(realpathSync(tmpdir()), 'ash-session-overlay-'))
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

function createManagedProfile(accountId: string): ClaudeProfileDescriptor {
  const profile = describeClaudeProfile(ash, accountId, {
    executionHostId: 'local',
    runtime: 'host'
  })
  const writeMarker = prepareClaudeProfileDirectory(ash, profile, join(root, 'synthetic-user-home'))
  writeMarker()
  return profile
}
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
    it('publishes only one complete overlay and receipt under concurrent duplicate creation', async () => {
      const id = randomUUID()
      const results = await Promise.allSettled([create(id), create(id)])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const recovered = await recoverAshClaudeSessionSettings(ash, id)
      expect(existsSync(`${recovered.settingsPath}.stage`)).toBe(false)
      expect(existsSync(`${recovered.settingsPath}.receipt.json.stage`)).toBe(false)
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
    it('retains a private durable receipt for verified cross-runtime recovery and resume', async () => {
      const existingProvider = readFileSync(join(external, 'settings.json'), 'utf8')
      const first = await create()
      const receiptPath = `${first.settingsPath}.receipt.json`
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
      expect(receipt).toEqual({ format: 1, sessionId: first.sessionId, sha256: first.sha256 })
      expect(lstatSync(receiptPath).mode & 0o777).toBe(0o600)
      expect(lstatSync(receiptPath).nlink).toBe(1)
      expect(existsSync(`${receiptPath}.stage`)).toBe(false)

      // Crash after hardlink publication but before stage unlink: this is the
      // one extra link recovery may accept, without deleting the residue.
      linkSync(receiptPath, `${receiptPath}.stage`)
      expect((await recoverAshClaudeSessionSettings(ash, first.sessionId)).sha256).toBe(
        first.sha256
      )
      expect(existsSync(`${receiptPath}.stage`)).toBe(true)
      unlinkSync(`${receiptPath}.stage`)
      linkSync(receiptPath, join(external, 'unrelated-receipt-hardlink'))
      await expect(recoverAshClaudeSessionSettings(ash, first.sessionId)).rejects.toThrow(
        'not a private regular file'
      )
      unlinkSync(join(external, 'unrelated-receipt-hardlink'))

      // A new runtime knows only the stable session UUID and private Ash root.
      const recovered = await recoverAshClaudeSessionSettings(ash, first.sessionId)
      expect(recovered).toEqual(first)
      const args = ['--resume', first.sessionId, '--model', 'sonnet']
      expect(await claudeVerifiedArgsWithAshSessionSettings(ash, first.sessionId, args)).toEqual([
        ...first.settingsArgs,
        ...args
      ])
      expect(args).toEqual(['--resume', first.sessionId, '--model', 'sonnet'])
      await expect(
        claudeVerifiedArgsWithAshSessionSettings(ash, first.sessionId, [
          '--settings',
          '/foreign.json'
        ])
      ).rejects.toThrow('caller already provides')
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(existingProvider)
    })
    it('recovers an account-bound v2 receipt after restart using the marked managed profile', async () => {
      const existingProvider = readFileSync(join(external, 'settings.json'), 'utf8')
      const profile = createManagedProfile('managed_claude_a')
      const sessionId = randomUUID()
      const created = await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId,
        hooks,
        managedAccountProfile: profile
      })
      const receiptPath = `${created.settingsPath}.receipt.json`
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
      expect(receipt.format).toBe(2)
      expect(receipt.sessionId).toBe(sessionId)
      expect(receipt.account).toMatchObject({
        version: 1,
        accountId: 'managed_claude_a',
        home: profile.home,
        runtime: 'host',
        hostPlatform: process.platform,
        configHomeIdentity: realpathSync(profile.home),
        configHomeDevice: lstatSync(profile.home, { bigint: true }).dev.toString(),
        configHomeInode: lstatSync(profile.home, { bigint: true }).ino.toString(),
        ownershipMarkerSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
      expect(lstatSync(receiptPath).mode & 0o777).toBe(0o600)

      // A new runtime has only the durable UUID, Ash root and host account descriptor.
      const recovered = await recoverAshClaudeSessionSettingsForManagedAccount(
        ash,
        sessionId,
        profile
      )
      expect(recovered).toEqual(created)
      expect(() => claudeArgsWithAshSessionSettings([], recovered)).toThrow(
        'account-bound Claude settings need managed-account verification'
      )
      expect(
        await claudeVerifiedArgsWithManagedAccountAshSessionSettings(ash, sessionId, profile, [
          '--resume',
          sessionId
        ])
      ).toEqual([...created.settingsArgs, '--resume', sessionId])
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(existingProvider)
    })
    it('refuses recovery after an account switch and never overwrites the original binding', async () => {
      const originalProvider = readFileSync(join(external, 'settings.json'), 'utf8')
      const accountA = createManagedProfile('managed_claude_a')
      const accountB = createManagedProfile('managed_claude_b')
      const sessionId = randomUUID()
      const created = await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId,
        hooks,
        managedAccountProfile: accountA
      })
      const receiptPath = `${created.settingsPath}.receipt.json`
      const receiptBytes = readFileSync(receiptPath, 'utf8')
      const settingsBytes = readFileSync(created.settingsPath, 'utf8')

      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, sessionId, accountB)
      ).rejects.toThrow('managed Claude account changed for this session')
      await expect(
        createAshClaudeSessionSettings({
          ashUserData: ash,
          sessionId,
          hooks,
          managedAccountProfile: accountB
        })
      ).rejects.toThrow('session settings already exist')
      expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes)
      expect(readFileSync(created.settingsPath, 'utf8')).toBe(settingsBytes)
      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, sessionId, accountA)
      ).resolves.toEqual(created)

      const otherSessionId = randomUUID()
      const otherSession = await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId: otherSessionId,
        hooks,
        managedAccountProfile: accountA
      })
      writeFileSync(`${otherSession.settingsPath}.receipt.json`, receiptBytes, { mode: 0o600 })
      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, otherSessionId, accountA)
      ).rejects.toThrow('session settings receipt is not account-bound')
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(originalProvider)
    })
    it('refuses a replacement physical config home even if its path and sibling marker are unchanged', async () => {
      const originalProvider = readFileSync(join(external, 'settings.json'), 'utf8')
      const profile = createManagedProfile('managed_claude_a')
      const originalIdentity = lstatSync(profile.home, { bigint: true })
      const sessionId = randomUUID()
      const created = await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId,
        hooks,
        managedAccountProfile: profile
      })
      const receiptPath = `${created.settingsPath}.receipt.json`
      const receiptBytes = readFileSync(receiptPath, 'utf8')
      const markerBytes = readFileSync(claudeProfileMarkerPath(profile), 'utf8')
      const retiredHome = join(root, 'retired-managed-claude-home')
      renameSync(profile.home, retiredHome)
      mkdirSync(profile.home, { mode: 0o700 })
      expect(realpathSync(profile.home)).toBe(profile.home)
      expect(lstatSync(profile.home, { bigint: true }).ino).not.toBe(originalIdentity.ino)
      expect(readFileSync(claudeProfileMarkerPath(profile), 'utf8')).toBe(markerBytes)
      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, sessionId, profile)
      ).rejects.toThrow('managed Claude account changed for this session')
      expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes)
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(originalProvider)
    })
    it('does not trust a copy that strips managed-account identity before calling the legacy argv helper', async () => {
      const profile = createManagedProfile('managed_claude_a')
      const sessionId = randomUUID()
      const bound = await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId,
        hooks,
        managedAccountProfile: profile
      })
      const forgedUnbound = { ...bound, managedAccountIdentity: undefined }
      expect(() =>
        claudeArgsWithAshSessionSettings(['--resume', sessionId], forgedUnbound)
      ).toThrow('account-bound Claude settings need managed-account verification')
      const unbound = await create()
      expect(() => claudeArgsWithAshSessionSettings([], { ...unbound })).toThrow(
        'account-bound Claude settings need managed-account verification'
      )
      expect(Object.isFrozen(bound)).toBe(true)
      expect(Object.isFrozen(bound.settingsArgs)).toBe(true)
      expect(Object.isFrozen(unbound)).toBe(true)
      expect(Object.isFrozen(unbound.settingsArgs)).toBe(true)
      expect(claudeArgsWithAshSessionSettings([], unbound)).toEqual(unbound.settingsArgs)
    })
    it('rejects marker tampering, profile symlink retargets and non-local profile descriptors', async () => {
      const originalProvider = readFileSync(join(external, 'settings.json'), 'utf8')
      const account = createManagedProfile('managed_claude_a')
      const sessionId = randomUUID()
      await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId,
        hooks,
        managedAccountProfile: account
      })
      const markerPath = claudeProfileMarkerPath(account)
      const markerBytes = readFileSync(markerPath, 'utf8')
      writeFileSync(markerPath, markerBytes.replace('managed_claude_a', 'tampered_account'), {
        mode: 0o600
      })
      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, sessionId, account)
      ).rejects.toThrow('managed Claude account identity is unavailable')
      writeFileSync(markerPath, markerBytes, { mode: 0o600 })

      const movedHome = join(root, 'retargeted-managed-home')
      renameSync(account.home, movedHome)
      symlinkSync(movedHome, account.home)
      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, sessionId, account)
      ).rejects.toThrow('managed Claude account identity is unavailable')
      unlinkSync(account.home)
      renameSync(movedHome, account.home)

      const wsl = {
        ...account,
        target: { executionHostId: 'local', runtime: 'wsl', distro: 'Ubuntu' }
      } as unknown as ClaudeProfileDescriptor
      const remote = {
        ...account,
        target: { executionHostId: 'ssh:example', runtime: 'host' }
      } as unknown as ClaudeProfileDescriptor
      const systemDefault = { ...account, home: join(root, 'system-default') }
      for (const unsupported of [wsl, remote, systemDefault]) {
        await expect(
          recoverAshClaudeSessionSettingsForManagedAccount(ash, sessionId, unsupported)
        ).rejects.toThrow('managed Claude account identity is unavailable')
      }
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(originalProvider)
    })
    it('keeps v1 overlays readable but never adopts them as account-bound', async () => {
      const originalProvider = readFileSync(join(external, 'settings.json'), 'utf8')
      const profile = createManagedProfile('managed_claude_a')
      const unbound = await create()
      await expect(recoverAshClaudeSessionSettings(ash, unbound.sessionId)).resolves.toEqual(
        unbound
      )
      await expect(
        recoverAshClaudeSessionSettingsForManagedAccount(ash, unbound.sessionId, profile)
      ).rejects.toThrow('session settings receipt is not account-bound')

      const bound = await createAshClaudeSessionSettings({
        ashUserData: ash,
        sessionId: randomUUID(),
        hooks,
        managedAccountProfile: profile
      })
      await expect(recoverAshClaudeSessionSettings(ash, bound.sessionId)).rejects.toThrow()
      expect(readFileSync(join(external, 'settings.json'), 'utf8')).toBe(originalProvider)
    })
    it('fails closed on a missing, malformed, wrong-session or tampered receipt', async () => {
      const record = await create()
      const receiptPath = `${record.settingsPath}.receipt.json`
      const original = readFileSync(receiptPath, 'utf8')
      for (const corrupt of [
        '{}',
        '{',
        JSON.stringify({ format: 1, sessionId: randomUUID(), sha256: record.sha256 }),
        JSON.stringify({ format: 1, sessionId: record.sessionId, sha256: 'a'.repeat(64) }),
        JSON.stringify({
          format: 1,
          sessionId: record.sessionId,
          sha256: record.sha256,
          extra: true
        }),
        'x'.repeat(1024)
      ]) {
        writeFileSync(receiptPath, corrupt)
        await expect(recoverAshClaudeSessionSettings(ash, record.sessionId)).rejects.toThrow()
        await expect(
          claudeVerifiedArgsWithAshSessionSettings(ash, record.sessionId, ['--resume', 'x'])
        ).rejects.toThrow()
      }
      writeFileSync(receiptPath, original)
      await expect(recoverAshClaudeSessionSettings(ash, record.sessionId)).resolves.toEqual(record)
      unlinkSync(receiptPath)
      await expect(recoverAshClaudeSessionSettings(ash, record.sessionId)).rejects.toThrow()
      expect(existsSync(record.settingsPath)).toBe(true)
    })
    it('refuses insecure or symlinked receipts and cross-profile recovery', async () => {
      const record = await create()
      const receiptPath = `${record.settingsPath}.receipt.json`
      await expect(recoverAshClaudeSessionSettings(external, record.sessionId)).rejects.toThrow()
      chmodSync(receiptPath, 0o644)
      await expect(recoverAshClaudeSessionSettings(ash, record.sessionId)).rejects.toThrow(
        'not a private regular file'
      )
      chmodSync(receiptPath, 0o600)
      const raw = readFileSync(receiptPath, 'utf8')
      unlinkSync(receiptPath)
      const alternate = join(external, 'foreign-receipt.json')
      writeFileSync(alternate, raw)
      symlinkSync(alternate, receiptPath)
      await expect(recoverAshClaudeSessionSettings(ash, record.sessionId)).rejects.toThrow(
        'not a private regular file'
      )
      expect(readFileSync(alternate, 'utf8')).toBe(raw)
    })
    it('does not silently complete or adopt an interrupted creation', async () => {
      const record = await create()
      const receiptPath = `${record.settingsPath}.receipt.json`
      const receipt = readFileSync(receiptPath, 'utf8')
      const originalSettings = readFileSync(record.settingsPath, 'utf8')
      unlinkSync(record.settingsPath) // simulated interrupted publication, not app cleanup
      await expect(recoverAshClaudeSessionSettings(ash, record.sessionId)).rejects.toThrow()
      await expect(create(record.sessionId)).rejects.toThrow('already exist')
      expect(readFileSync(receiptPath, 'utf8')).toBe(receipt)
      expect(existsSync(record.settingsPath)).toBe(false)
      expect(existsSync(`${receiptPath}.stage`)).toBe(false)

      // A crash after settings publication but before its receipt cannot be
      // repaired by another create, even if requested hooks are byte-identical.
      const secondId = randomUUID()
      const secondPath = join(ash, 'provider-session-settings', `claude-${secondId}.json`)
      writeFileSync(secondPath, originalSettings, { mode: 0o600 })
      await expect(recoverAshClaudeSessionSettings(ash, secondId)).rejects.toThrow()
      await expect(create(secondId)).rejects.toThrow('already exist')
      expect(existsSync(`${secondPath}.receipt.json`)).toBe(false)
      expect(existsSync(`${secondPath}.stage`)).toBe(false)
    })
    it('preserves an interrupted receipt stage without allowing unsafe recovery', async () => {
      const id = randomUUID()
      const directory = join(ash, 'provider-session-settings')
      mkdirSync(directory, { mode: 0o700 })
      const path = join(directory, `claude-${id}.json`)
      const staged = `${path}.receipt.json.stage`
      writeFileSync(staged, 'interrupted stage', { mode: 0o600 })
      await expect(create(id)).rejects.toThrow('stage already exists')
      expect(readFileSync(staged, 'utf8')).toBe('interrupted stage')
      expect(existsSync(path)).toBe(true)
      expect(existsSync(`${path}.receipt.json`)).toBe(false)
      await expect(recoverAshClaudeSessionSettings(ash, id)).rejects.toThrow()
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
