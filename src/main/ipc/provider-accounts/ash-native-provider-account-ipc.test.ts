import { beforeEach, expect, it, vi } from 'vitest'
import type { CodexAccountService } from '../../codex-accounts/service'
import type { ClaudeAccountService } from '../../claude-accounts/service'
import type { GlobalSettings } from '../../../shared/global-settings-types'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trustedSender: { id: 82 },
  sendToTrustedUIRenderer: vi.fn(),
  listRecordedCodexPaneLanes: vi.fn(() => ({ local_pty: 'host' })),
  listStaleCodexPanes: vi.fn(() => [
    { ptyId: 'local_pty', launchAccountId: null, activeAccountId: 'codex-1' }
  ]),
  forgetStaleCodexPanes: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, listener: (...args: unknown[]) => unknown) => {
      if (fixture.handlers.has(name)) {
        throw new Error(`Duplicate native account IPC: ${name}`)
      }
      fixture.handlers.set(name, listener)
    }
  }
}))
vi.mock('../ui', () => ({
  getTrustedUIRendererWebContents: () => fixture.trustedSender,
  sendToTrustedUIRenderer: fixture.sendToTrustedUIRenderer
}))
vi.mock('../../codex/configuration/homes/codex-pane-account-registry', () => ({
  listRecordedCodexPaneLanes: fixture.listRecordedCodexPaneLanes
}))
vi.mock('../../codex/configuration/homes/codex-stale-pane-accounts', () => ({
  listStaleCodexPanes: fixture.listStaleCodexPanes,
  forgetStaleCodexPanes: fixture.forgetStaleCodexPanes
}))

import { registerCodexAccountHandlers } from '../codex-accounts'
import { registerClaudeAccountHandlers } from '../claude-accounts'
import { CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL } from '../../../shared/codex-auth-errors'

const codex = {
  listAccounts: vi.fn(() => ({ accounts: [], activeAccountId: null })),
  addAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  cancelPendingLogin: vi.fn(() => false),
  getPendingLoginUrl: vi.fn(() => null),
  onPendingLoginUrlChanged: vi.fn(),
  reauthenticateAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  removeAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  selectAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  selectAccountForTarget: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
}

const claude = {
  listAccounts: vi.fn(() => ({ accounts: [], activeAccountId: null })),
  addAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  cancelPendingLogin: vi.fn(() => false),
  reauthenticateAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  waitForSignInLink: vi.fn(async () => null),
  removeAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  selectAccount: vi.fn(async () => ({ accounts: [], activeAccountId: null })),
  selectAccountForTarget: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
}

function invoke(channel: string, input?: unknown, sender: unknown = fixture.trustedSender) {
  const handler = fixture.handlers.get(channel)
  if (!handler) {
    throw new Error(`Handler missing: ${channel}`)
  }
  return handler({ sender }, input)
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.handlers.clear()
  // The real services are never instantiated: account mutation is stubbed to
  // prevent this test reading/writing a real Codex or Claude credential home.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only mocked Codex methods registered by this IPC layer are called, never any unimplemented account service method.
  const codexService = codex as unknown as CodexAccountService
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pane-attribution helper is mocked and never inspects the partial settings fixture.
  const settings = { activeCodexManagedAccountId: null } as GlobalSettings
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only mocked Claude account methods registered by this IPC layer are called, never any unimplemented account service method.
  const claudeService = claude as unknown as ClaudeAccountService
  registerCodexAccountHandlers(codexService, () => settings)
  registerClaudeAccountHandlers(claudeService)
})

it('registers every retained local provider account and Codex pane IPC exactly once', () => {
  expect([...fixture.handlers.keys()].sort()).toEqual(
    [
      'codexAccounts:listStalePanes',
      'codexAccounts:listRecordedPaneLanes',
      'codexAccounts:forgetStalePanes',
      'codexAccounts:list',
      'codexAccounts:add',
      'codexAccounts:cancelPendingLogin',
      'codexAccounts:pendingLoginUrl',
      'codexAccounts:reauthenticate',
      'codexAccounts:remove',
      'codexAccounts:select',
      'claudeAccounts:list',
      'claudeAccounts:add',
      'claudeAccounts:cancelPendingLogin',
      'claudeAccounts:reauthenticate',
      'claudeAccounts:waitForSignInLink',
      'claudeAccounts:remove',
      'claudeAccounts:select'
    ].sort()
  )
  expect(invoke('codexAccounts:list')).toEqual({ accounts: [], activeAccountId: null })
  expect(invoke('claudeAccounts:list')).toEqual({ accounts: [], activeAccountId: null })
  expect(invoke('codexAccounts:pendingLoginUrl')).toBeNull()
  expect(invoke('claudeAccounts:cancelPendingLogin')).toBe(false)
  expect(invoke('codexAccounts:cancelPendingLogin')).toBe(false)
})

it('delegates valid host-only account actions without changing provider homes in the test', async () => {
  await invoke('codexAccounts:add', { runtime: 'host' })
  expect(codex.addAccount).toHaveBeenCalledWith({ runtime: 'host' })
  await invoke('codexAccounts:reauthenticate', {
    accountId: 'codex-1',
    activateIfSelectionWasEmpty: true
  })
  expect(codex.reauthenticateAccount).toHaveBeenCalledWith('codex-1', {
    activateIfSelectionWasEmpty: true
  })
  await invoke('codexAccounts:select', { accountId: 'codex-1', runtime: 'host' })
  expect(codex.selectAccountForTarget).toHaveBeenCalledWith('codex-1', {
    runtime: 'host'
  })
  await invoke('codexAccounts:select', { accountId: 'codex-1' })
  expect(codex.selectAccountForTarget).toHaveBeenLastCalledWith('codex-1', { runtime: 'host' })
  expect(codex.selectAccount).not.toHaveBeenCalled()
  await invoke('codexAccounts:remove', { accountId: 'codex-1' })
  expect(codex.removeAccount).toHaveBeenCalledWith('codex-1')

  await invoke('claudeAccounts:add', { runtime: 'host', copyLink: true })
  expect(claude.addAccount).toHaveBeenCalledWith({ runtime: 'host', copyLink: true }, true)
  await invoke('claudeAccounts:reauthenticate', { accountId: 'claude-1' })
  expect(claude.reauthenticateAccount).toHaveBeenCalledWith('claude-1', undefined)
  await invoke('claudeAccounts:select', { accountId: null, runtime: 'host' })
  expect(claude.selectAccountForTarget).toHaveBeenCalledWith(null, {
    runtime: 'host'
  })
  await invoke('claudeAccounts:select', { accountId: null })
  expect(claude.selectAccountForTarget).toHaveBeenLastCalledWith(null, { runtime: 'host' })
  expect(claude.selectAccount).not.toHaveBeenCalled()
  await invoke('claudeAccounts:remove', { accountId: 'claude-1' })
  expect(claude.removeAccount).toHaveBeenCalledWith('claude-1')
})

it('preserves bounded local Codex pane attribution and sends OAuth links only to trusted UI', () => {
  expect(invoke('codexAccounts:listRecordedPaneLanes', { ptyIds: ['local_pty'] })).toEqual({
    local_pty: 'host'
  })
  expect(fixture.listRecordedCodexPaneLanes).toHaveBeenCalledWith(['local_pty'])
  expect(invoke('codexAccounts:listStalePanes', { ptyIds: ['local_pty'] })).toEqual([
    { ptyId: 'local_pty', launchAccountId: null, activeAccountId: 'codex-1' }
  ])
  expect(invoke('codexAccounts:forgetStalePanes', { ptyIds: ['local_pty'] })).toBeUndefined()
  expect(fixture.forgetStaleCodexPanes).toHaveBeenCalledWith(['local_pty'])

  expect(codex.onPendingLoginUrlChanged).toHaveBeenCalledOnce()
  const callback = codex.onPendingLoginUrlChanged.mock.calls[0]?.[0]
  expect(typeof callback).toBe('function')
  callback?.('https://auth.openai.com/example?state=private')
  expect(fixture.sendToTrustedUIRenderer).toHaveBeenCalledWith(
    CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL,
    'https://auth.openai.com/example?state=private'
  )
})

it('refuses every provider account IPC from an untrusted webContents sender', () => {
  for (const channel of fixture.handlers.keys()) {
    expect(() => invoke(channel, {}, { id: 999 }), channel).toThrow(
      'Unauthorized provider account IPC sender'
    )
  }
  expect(codex.addAccount).not.toHaveBeenCalled()
  expect(claude.addAccount).not.toHaveBeenCalled()
  expect(fixture.forgetStaleCodexPanes).not.toHaveBeenCalled()
})

it('rejects malformed, unknown and remote-development arguments before account mutations', async () => {
  const cases = [
    ['codexAccounts:add', { runtime: 'wsl', wslDistro: 'Ubuntu' }],
    ['claudeAccounts:add', { runtime: 'wsl', wslDistro: 'Ubuntu' }],
    ['codexAccounts:add', { cloudUserId: 'legacy-cloud-id' }],
    ['codexAccounts:select', { accountId: 'codex-1', runtime: 'wsl' }],
    ['claudeAccounts:select', { accountId: 'claude-1', remoteHostId: 'ssh' }],
    ['codexAccounts:remove', { accountId: '' }],
    ['claudeAccounts:remove', { accountId: 12 }],
    ['codexAccounts:reauthenticate', { accountId: 'codex-1', copyLink: 'yes' }],
    ['claudeAccounts:reauthenticate', { accountId: 'claude-1', copyLink: 'yes' }],
    ['codexAccounts:forgetStalePanes', { ptyIds: ['local_pty', 123] }],
    ['codexAccounts:listRecordedPaneLanes', { ptyIds: Array(257).fill('x') }]
  ] as const
  for (const [channel, value] of cases) {
    await expect(
      Promise.resolve().then(() => invoke(channel, value)),
      channel
    ).rejects.toThrow()
  }
  expect(codex.addAccount).not.toHaveBeenCalled()
  expect(codex.selectAccountForTarget).not.toHaveBeenCalled()
  expect(codex.removeAccount).not.toHaveBeenCalled()
  expect(claude.addAccount).not.toHaveBeenCalled()
  expect(claude.selectAccountForTarget).not.toHaveBeenCalled()
  expect(claude.removeAccount).not.toHaveBeenCalled()
  expect(fixture.forgetStaleCodexPanes).not.toHaveBeenCalled()
})
