import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAshClaudeSessionSettings } from '../../../agent-hooks/session/ash-claude-session-settings'
import type {
  HostClaudeSessionOverlayContext,
  HostClaudeSessionOverlayLaunchRequest
} from './ash-claude-session-overlay-launch'
import { prepareHostClaudeSessionOverlayLaunch } from './ash-claude-session-overlay-launch'
import { CLAUDE_INJECTED_CONFIG_DIR_ENV } from '../../../../shared/claude-profile-routing'
import {
  setupLayoutOwnerRuntime,
  WORKTREE_ID
} from '../../orca-runtime-tests/orca-runtime-layout-owner-start-fixture'
import { committingSpawn } from '../../orca-runtime-tests/bind-first-pane.test-fixture'
import type { RuntimePtyController } from '../../runtime-pty-controller-contract'

vi.mock('../../../../shared/layout-owner-switch', () => ({ ORCA_LAYOUT_OWNER_IS_MAIN: true }))

const roots: string[] = []
type UnsafeCase = {
  request?: Partial<HostClaudeSessionOverlayLaunchRequest>
  context?: Partial<HostClaudeSessionOverlayContext>
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ash-claude-launch-'))
  roots.push(root)
  const userDataPath = join(root, 'ash-user-data')
  const accountConfigDir = join(root, 'selected-claude-account')
  const foreignSettingsPath = join(accountConfigDir, 'settings.json')
  const foreignSettings =
    '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"foreign-hook"}]}]}}\n'
  await mkdir(userDataPath, { recursive: true, mode: 0o700 })
  await mkdir(accountConfigDir, { recursive: true })
  await writeFile(foreignSettingsPath, foreignSettings)
  const sessionId = randomUUID()
  const overlay = await createAshClaudeSessionSettings({
    ashUserData: userDataPath,
    sessionId,
    hooks: [{ event: 'SessionStart', scriptPath: '/ash-owned/hooks/session-start' }]
  })
  const context: HostClaudeSessionOverlayContext = {
    launchAgent: 'claude',
    command: `claude --resume ${sessionId}`,
    executionPlatform: process.platform,
    hostPlatform: process.platform,
    isRemote: false,
    isWsl: false,
    isLiveReattach: false,
    shell: 'posix',
    selectedAccount: { id: 'account-selected-by-host', configDir: accountConfigDir },
    effectiveEnv: {
      CLAUDE_CONFIG_DIR: accountConfigDir,
      [CLAUDE_INJECTED_CONFIG_DIR_ENV]: accountConfigDir
    },
    ambientEnv: {}
  }
  return {
    root,
    userDataPath,
    accountConfigDir,
    foreignSettingsPath,
    foreignSettings,
    sessionId,
    overlay,
    context
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('host-only Claude session overlay launch adapter', () => {
  it('stays disabled without explicit host intent and does not need a root', async () => {
    await expect(prepareHostClaudeSessionOverlayLaunch({})).resolves.toEqual({ kind: 'disabled' })
  })

  it('refuses a missing receipt without creating an overlay', async () => {
    const fixture = await createFixture()
    const missingSessionId = randomUUID()
    const settingsPath = join(
      fixture.userDataPath,
      'provider-session-settings',
      `claude-${missingSessionId}.json`
    )

    await expect(
      prepareHostClaudeSessionOverlayLaunch({
        request: {
          mode: 'resume',
          sessionId: missingSessionId,
          accountId: 'account-selected-by-host',
          accountConfigDir: fixture.accountConfigDir
        },
        userDataPath: fixture.userDataPath,
        context: {
          ...fixture.context,
          command: `claude --resume ${missingSessionId}`,
          providerSession: { key: 'session_id', id: missingSessionId }
        }
      })
    ).rejects.toThrow()
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(fixture.foreignSettingsPath, 'utf8')).toBe(fixture.foreignSettings)
  })

  it.skipIf(process.platform === 'win32')(
    're-verifies the Ash receipt and adds one settings pair to each explicit fresh or resume process',
    async () => {
      const fixture = await createFixture()
      const fresh = await prepareHostClaudeSessionOverlayLaunch({
        request: {
          mode: 'fresh',
          sessionId: fixture.sessionId,
          accountId: 'account-selected-by-host',
          accountConfigDir: fixture.accountConfigDir
        },
        userDataPath: fixture.userDataPath,
        context: {
          ...fixture.context,
          command: `claude --session-id ${fixture.sessionId}`,
          providerSession: undefined
        }
      })
      const resumed = await prepareHostClaudeSessionOverlayLaunch({
        request: {
          mode: 'resume',
          sessionId: fixture.sessionId,
          accountId: 'account-selected-by-host',
          accountConfigDir: fixture.accountConfigDir
        },
        userDataPath: fixture.userDataPath,
        context: {
          ...fixture.context,
          providerSession: { key: 'session_id', id: fixture.sessionId }
        }
      })

      for (const launch of [fresh, resumed]) {
        expect(launch.kind).toBe('prepared')
        if (launch.kind !== 'prepared') {
          continue
        }
        expect(launch.argv.filter((arg) => arg === '--settings')).toHaveLength(1)
        expect(launch.argv).toContain(fixture.overlay.settingsPath)
        expect(launch.argv).toContain(fixture.sessionId)
        expect(launch.command).toContain('--settings')
        expect(launch.command).toContain(fixture.overlay.settingsPath)
      }
      expect(await readFile(fixture.foreignSettingsPath, 'utf8')).toBe(fixture.foreignSettings)
    }
  )

  const unsafeCases: [string, UnsafeCase][] = [
    [
      'provider session mismatch',
      { context: { providerSession: { key: 'session_id', id: randomUUID() } } }
    ],
    [
      'wrong provider session key',
      { context: { providerSession: { key: 'conversation_id', id: 'session' } } }
    ],
    [
      'existing split settings option',
      { context: { command: 'claude --settings /user/settings.json --resume SESSION' } }
    ],
    [
      'existing joined settings option',
      { context: { command: 'claude --settings=/user/settings.json --resume SESSION' } }
    ],
    ['remote execution', { context: { isRemote: true } }],
    ['WSL execution', { context: { isWsl: true } }],
    ['live reattach', { context: { isLiveReattach: true } }],
    ['Windows host', { context: { hostPlatform: 'win32' } }],
    ['execution host mismatch', { context: { executionPlatform: 'win32' } }],
    ['non-POSIX shell', { context: { shell: 'powershell' } }],
    ['custom shell override', { context: { shellOverride: '/bin/bash' } }],
    ['unknown selected account', { context: { selectedAccount: null } }],
    [
      'selected account mismatch',
      { context: { selectedAccount: { id: 'other', configDir: '/other' } } }
    ],
    [
      'effective account path mismatch',
      { context: { effectiveEnv: { CLAUDE_CONFIG_DIR: '/other' } } }
    ],
    [
      'caller account override',
      { context: { callerEnvOverrides: [{ CLAUDE_CONFIG_DIR: '/other' }] } }
    ],
    [
      'caller auth override',
      { context: { callerEnvOverrides: [{ ANTHROPIC_API_KEY: 'synthetic' }] } }
    ],
    [
      'ambient auth environment',
      { context: { ambientEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'synthetic' } } }
    ],
    ['shell command syntax', { context: { command: 'claude --resume SESSION; echo unsafe' } }],
    ['custom command wrapper', { context: { command: 'bash -lc "claude --resume SESSION"' } }],
    ['custom Claude executable path', { context: { command: './claude --resume SESSION' } }],
    ['unsupported extra option', { context: { command: 'claude --verbose --resume SESSION' } }],
    ['session id is not UUIDv4', { request: { sessionId: 'SESSION' } }]
  ]

  it.each(unsafeCases)(
    'fails closed for %s without changing provider settings',
    async (_label, change) => {
      const fixture = await createFixture()
      const request = {
        mode: 'resume' as const,
        sessionId: fixture.sessionId,
        accountId: 'account-selected-by-host',
        accountConfigDir: fixture.accountConfigDir,
        ...change.request
      }
      const context = {
        ...fixture.context,
        providerSession: { key: 'session_id' as const, id: fixture.sessionId },
        ...change.context
      } as HostClaudeSessionOverlayContext

      await expect(
        prepareHostClaudeSessionOverlayLaunch({
          request,
          userDataPath: fixture.userDataPath,
          context
        })
      ).rejects.toThrow()
      expect(await readFile(fixture.foreignSettingsPath, 'utf8')).toBe(fixture.foreignSettings)
    }
  )

  it('keeps the durable overlay when the GUI tab closes and the daemon-owned process exits', async () => {
    const fixture = await createFixture()
    const { runtime } = setupLayoutOwnerRuntime()
    type SpawnOptions = Parameters<NonNullable<RuntimePtyController['spawn']>>[0]
    const dispatched: SpawnOptions[] = []
    const spawn = vi.fn(async (args: SpawnOptions) => {
      dispatched.push(args)
      return { id: 'pty-1' }
    })
    const kill = vi.fn(() => true)
    runtime.setPtyController({
      spawn: committingSpawn(runtime, spawn),
      write: () => true,
      kill,
      getForegroundProcess: async () => null
    })
    const tabId = randomUUID()
    await runtime.createTerminal(`id:${WORKTREE_ID}`, {
      command: `claude --resume ${fixture.sessionId}`,
      launchAgent: 'claude',
      resumeProviderSession: { key: 'session_id', id: fixture.sessionId },
      tabId,
      leafId: randomUUID()
    })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(dispatched[0]).toMatchObject({
      command: `claude --resume ${fixture.sessionId}`,
      launchAgent: 'claude',
      resumeProviderSession: { key: 'session_id', id: fixture.sessionId }
    })
    expect(dispatched[0]?.command ?? '').not.toContain('--settings')
    expect(await readFile(fixture.overlay.settingsPath, 'utf8')).toContain('SessionStart')

    await runtime.applyLayoutCommand({
      type: 'closeTabs',
      workspace: WORKTREE_ID,
      tabIds: [tabId],
      recordClose: 'user'
    })
    expect(kill).not.toHaveBeenCalled()
    expect(await readFile(fixture.overlay.settingsPath, 'utf8')).toContain('SessionStart')
    await runtime.onPtyExit('pty-1', 0)
    expect(await readFile(fixture.overlay.settingsPath, 'utf8')).toContain('SessionStart')
    expect(await readFile(fixture.foreignSettingsPath, 'utf8')).toBe(fixture.foreignSettings)
  })
})
