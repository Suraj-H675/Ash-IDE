import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import { sleepingAgentSessionRecordSchema } from '../../../../shared/workspace-session/workspace-session-sleeping-agents'
import { createAshClaudeSessionSettings } from '../../../agent-hooks/session/ash-claude-session-settings'
import { MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES } from '../../../agent-hooks/session/ash-claude-session-settings-publication'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  prepareClaudeProfileDirectory,
  type ClaudeProfileDescriptor
} from '../../../claude-accounts/claude-profile-paths'
import { recoverOriginalManagedClaudeAccountForSavedSession } from './ash-claude-session-overlay-recovery'

const ACCOUNT_A = 'managed_claude_a'
const ACCOUNT_B = 'managed_claude_b'
const FOREIGN_SETTINGS =
  '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"foreign-hook"}]}]}}\n'
const HOOKS = [{ event: 'SessionStart' as const, scriptPath: '/ash/hooks/session-start' }]
const roots: string[] = []
const INCONSISTENT_RECORDS: [string, Record<string, unknown>][] = [
  ['wrong agent', { agent: 'codex' }],
  ['remote connection', { connectionId: 'ssh-host-1' }],
  ['WSL runtime', { runtime: 'wsl' }],
  ['WSL launch environment', { launchConfig: { agentEnv: { WSL_DISTRO_NAME: 'Ubuntu' } } }],
  ['WSL command', { launchConfig: { agentCommand: 'wsl.exe -d Ubuntu claude' } }],
  [
    'provider key mismatch',
    { providerSession: { key: 'conversation_id', id: '00000000-0000-4000-8000-000000000000' } }
  ],
  ['non-UUID session id', { providerSession: { key: 'session_id', id: 'anonymous-session' } }],
  [
    'fork metadata',
    {
      providerSession: {
        key: 'session_id',
        id: '00000000-0000-4000-8000-000000000000',
        forkedFromSessionId: 'parent'
      }
    }
  ],
  ['anonymous session', { isAnonymous: true }]
]

type Fixture = {
  root: string
  ashUserData: string
  providerSettingsPath: string
  profileA: ClaudeProfileDescriptor
  profileB: ClaudeProfileDescriptor
  sessionId: string
  settingsPath: string
  record: SleepingAgentSessionRecord
}

function createManagedProfile(ashUserData: string, root: string, accountId: string) {
  const profile = describeClaudeProfile(ashUserData, accountId, {
    runtime: 'host',
    executionHostId: 'local'
  })
  const writeMarker = prepareClaudeProfileDirectory(
    ashUserData,
    profile,
    join(root, 'synthetic-user-home')
  )
  writeMarker()
  return profile
}

function savedRecord(sessionId: string): SleepingAgentSessionRecord {
  return {
    paneKey: 'pane-1',
    worktreeId: 'worktree-1',
    agent: 'claude',
    providerSession: { key: 'session_id', id: sessionId },
    prompt: 'synthetic prompt',
    state: 'waiting',
    capturedAt: 1,
    updatedAt: 1,
    connectionId: null,
    launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} }
  }
}

async function createFixture(accountId = ACCOUNT_A): Promise<Fixture> {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'ash-session-recovery-'))
  roots.push(root)
  const ashUserData = join(root, 'ash-private')
  const providerHome = join(root, 'provider-home')
  mkdirSync(ashUserData, { mode: 0o700 })
  mkdirSync(providerHome, { mode: 0o700 })
  const providerSettingsPath = join(providerHome, 'settings.json')
  writeFileSync(providerSettingsPath, FOREIGN_SETTINGS, { mode: 0o600 })

  const profileA = createManagedProfile(ashUserData, root, accountId)
  const profileB = createManagedProfile(ashUserData, root, ACCOUNT_B)
  const sessionId = randomUUID()
  const settings = await createAshClaudeSessionSettings({
    ashUserData,
    sessionId,
    hooks: HOOKS,
    managedAccountProfile: profileA
  })
  return {
    root,
    ashUserData,
    providerSettingsPath,
    profileA,
    profileB,
    sessionId,
    settingsPath: settings.settingsPath,
    record: savedRecord(sessionId)
  }
}

function expectProviderSettingsUnchanged(fixture: Fixture) {
  expect(readFileSync(fixture.providerSettingsPath, 'utf8')).toBe(FOREIGN_SETTINGS)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')(
  'saved Claude session account recovery is host-only consistency validation',
  () => {
    it('recovers account A even after the mutable host-selection pointer targets B', async () => {
      const fixture = await createFixture()
      expect(sleepingAgentSessionRecordSchema.safeParse(fixture.record).success).toBe(true)
      // Simulate a later selection change using only the disposable Ash-owned
      // pointer file; the original session's receipt must still select A.
      const pointerPath = join(fixture.ashUserData, 'claude-profiles', 'selected-host')
      writeFileSync(pointerPath, fixture.profileB.home, { mode: 0o600 })

      const recovered = await recoverOriginalManagedClaudeAccountForSavedSession({
        ashUserData: fixture.ashUserData,
        record: fixture.record
      })

      expect(readFileSync(pointerPath, 'utf8')).toBe(fixture.profileB.home)
      expect(recovered).toMatchObject({
        kind: 'consistency-only',
        sessionId: fixture.sessionId,
        originalProfile: fixture.profileA,
        managedAccountIdentity: { accountId: ACCOUNT_A, runtime: 'host' }
      })
      expect(Object.isFrozen(recovered)).toBe(true)
      expect('settingsArgv' in recovered).toBe(false)
      expect('command' in recovered).toBe(false)
      expectProviderSettingsUnchanged(fixture)
    })

    it.each(INCONSISTENT_RECORDS)('refuses saved-record mismatch: %s', async (label, changes) => {
      const fixture = await createFixture()
      const suppliedLaunchConfig = changes.launchConfig as Record<string, unknown> | undefined
      const badRecord = {
        ...fixture.record,
        ...changes,
        ...(suppliedLaunchConfig
          ? { launchConfig: { ...fixture.record.launchConfig, ...suppliedLaunchConfig } }
          : {}),
        providerSession: changes.providerSession ?? fixture.record.providerSession
      }
      const expectedReasons: Record<string, string> = {
        'wrong agent': 'saved session is not a Claude session',
        'remote connection': 'saved session is remote',
        'WSL runtime': 'saved Claude session is not a host session',
        'WSL launch environment': 'saved Claude launch environment indicates WSL',
        'WSL command': 'saved Claude launch command indicates a remote runtime',
        'provider key mismatch': 'saved provider session is not a Claude session_id',
        'non-UUID session id': 'saved Claude session id is not a UUIDv4',
        'fork metadata': 'saved Claude session has fork metadata',
        'anonymous session': 'saved session has a isAnonymous marker'
      }
      if (label === 'fork metadata') {
        // Keep the UUID valid AND owned by this fixture: a wrong UUID should
        // never be the reason a fork/refusal case passes.
        badRecord.providerSession = {
          ...(changes.providerSession as Record<string, unknown>),
          id: fixture.sessionId
        }
      }

      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: fixture.ashUserData,
          record: badRecord
        })
      ).rejects.toThrow(expectedReasons[label])
      expectProviderSettingsUnchanged(fixture)
    })

    it('rejects a UUID that names another session receipt', async () => {
      const fixture = await createFixture()
      const otherSessionId = randomUUID()
      const otherSettings = await createAshClaudeSessionSettings({
        ashUserData: fixture.ashUserData,
        sessionId: otherSessionId,
        hooks: HOOKS,
        managedAccountProfile: fixture.profileB
      })
      writeFileSync(
        `${otherSettings.settingsPath}.receipt.json`,
        readFileSync(`${fixture.settingsPath}.receipt.json`),
        { mode: 0o600 }
      )

      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: fixture.ashUserData,
          record: savedRecord(otherSessionId)
        })
      ).rejects.toThrow('not account-bound to this session')
      expectProviderSettingsUnchanged(fixture)
    })

    it('does not promote a compatible unbound version-1 receipt', async () => {
      const fixture = await createFixture()
      const unboundSessionId = randomUUID()
      const unbound = await createAshClaudeSessionSettings({
        ashUserData: fixture.ashUserData,
        sessionId: unboundSessionId,
        hooks: HOOKS
      })

      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: fixture.ashUserData,
          record: savedRecord(unboundSessionId)
        })
      ).rejects.toThrow('not account-bound')
      expect(lstatSync(`${unbound.settingsPath}.receipt.json`).isFile()).toBe(true)
      expectProviderSettingsUnchanged(fixture)
    })

    it.each(['unknown_managed_account', 'system-default'])(
      'refuses receipt account %s without a verified managed profile',
      async (accountId) => {
        const fixture = await createFixture()
        const receiptPath = `${fixture.settingsPath}.receipt.json`
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>
        const account = receipt.account as Record<string, unknown>
        writeFileSync(
          receiptPath,
          `${JSON.stringify({ ...receipt, account: { ...account, accountId } })}\n`,
          { mode: 0o600 }
        )

        await expect(
          recoverOriginalManagedClaudeAccountForSavedSession({
            ashUserData: fixture.ashUserData,
            record: fixture.record
          })
        ).rejects.toThrow('managed Claude account identity is unavailable')
        expectProviderSettingsUnchanged(fixture)
      }
    )

    it('refuses a corrupt receipt without repairing or replacing it', async () => {
      const fixture = await createFixture()
      const receiptPath = `${fixture.settingsPath}.receipt.json`
      writeFileSync(receiptPath, '{broken-json', { mode: 0o600 })

      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: fixture.ashUserData,
          record: fixture.record
        })
      ).rejects.toThrow('receipt is malformed')
      expect(readFileSync(receiptPath, 'utf8')).toBe('{broken-json')
      expectProviderSettingsUnchanged(fixture)
    })

    it('refuses an oversized private receipt without reading, rewriting, or adopting it', async () => {
      const fixture = await createFixture()
      const receiptPath = `${fixture.settingsPath}.receipt.json`
      const tooLarge = 'x'.repeat(MAX_ASH_CLAUDE_SESSION_SETTINGS_BYTES + 1)
      writeFileSync(receiptPath, tooLarge, { mode: 0o600 })
      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: fixture.ashUserData,
          record: fixture.record
        })
      ).rejects.toThrow('session settings file is not a private regular file')
      expect(readFileSync(receiptPath, 'utf8')).toBe(tooLarge)
      expectProviderSettingsUnchanged(fixture)
    })

    it('refuses foreign hard-linked, symlinked, and public receipts', async () => {
      const cases = [
        {
          name: 'hard-linked',
          prepare: (receiptPath: string, root: string) =>
            linkSync(receiptPath, join(root, 'foreign-receipt-link'))
        },
        {
          name: 'symlinked',
          prepare: (receiptPath: string, root: string) => {
            const target = join(root, 'foreign-receipt.json')
            writeFileSync(target, '{"foreign":true}\n', { mode: 0o600 })
            unlinkSync(receiptPath)
            symlinkSync(target, receiptPath)
          }
        },
        {
          name: 'world-readable',
          prepare: (receiptPath: string) => chmodSync(receiptPath, 0o644)
        }
      ] as const

      for (const testCase of cases) {
        const fixture = await createFixture()
        const receiptPath = `${fixture.settingsPath}.receipt.json`
        testCase.prepare(receiptPath, fixture.root)
        await expect(
          recoverOriginalManagedClaudeAccountForSavedSession({
            ashUserData: fixture.ashUserData,
            record: fixture.record
          })
        ).rejects.toThrow('not a private regular file')
        expectProviderSettingsUnchanged(fixture)
      }
    })

    it('rejects tampered ownership markers and replaced physical profile directories', async () => {
      const markerFixture = await createFixture()
      const markerPath = claudeProfileMarkerPath(markerFixture.profileA)
      const marker = readFileSync(markerPath, 'utf8')
      writeFileSync(markerPath, marker.replace(ACCOUNT_A, 'foreign_account'), { mode: 0o600 })
      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: markerFixture.ashUserData,
          record: markerFixture.record
        })
      ).rejects.toThrow('managed Claude account identity is unavailable')
      expectProviderSettingsUnchanged(markerFixture)

      const directoryFixture = await createFixture()
      const originalInode = lstatSync(directoryFixture.profileA.home, { bigint: true }).ino
      const retiredHome = join(directoryFixture.root, 'retired-profile-home')
      renameSync(directoryFixture.profileA.home, retiredHome)
      mkdirSync(directoryFixture.profileA.home, { mode: 0o700 })
      expect(lstatSync(directoryFixture.profileA.home, { bigint: true }).ino).not.toBe(
        originalInode
      )
      await expect(
        recoverOriginalManagedClaudeAccountForSavedSession({
          ashUserData: directoryFixture.ashUserData,
          record: directoryFixture.record
        })
      ).rejects.toThrow('managed Claude account changed for this session')
      expectProviderSettingsUnchanged(directoryFixture)
    })
  }
)
