import { describe, expect, it, vi } from 'vitest'
import type { CodexManagedAccount } from '../../shared/managed-account-types'
import { createCodexAccountSettings } from './codex-account-settings-fixture'
import { CodexAccountSelection } from './codex-account-selection'

const hostAccount = (id: string): CodexManagedAccount => ({
  id,
  email: `${id}@example.test`,
  managedHomePath: `/fixture/ash/codex-accounts/${id}/home`,
  managedHomeRuntime: 'host',
  providerAccountId: null,
  workspaceLabel: null,
  workspaceAccountId: null,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
})

function fixture(options: { failOnSync?: 'once' | 'always'; wsl?: boolean } = {}) {
  const selected = hostAccount('account-old')
  const replacement = options.wsl
    ? { ...hostAccount('account-new'), managedHomeRuntime: 'wsl' as const, wslDistro: 'Ubuntu' }
    : hostAccount('account-new')
  let settings = createCodexAccountSettings('/fixture/ash', {
    codexManagedAccounts: [selected, replacement],
    activeCodexManagedAccountId: selected.id,
    activeCodexManagedAccountIdsByRuntime: {
      host: selected.id,
      wsl: { ...(options.wsl ? { Ubuntu: 'account-new' } : {}) }
    }
  })
  const store = {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn((patch: Partial<typeof settings>) => {
      settings = { ...settings, ...patch }
    })
  }
  const refreshForCodexAccountChange = vi.fn(async () => {})
  const onHostSystemDefaultSelected = vi.fn()
  const error = new Error('injected runtime-home selection failure')
  const syncForCurrentSelection = vi.fn().mockImplementation(() => {
    if (options.failOnSync === 'always' || (options.failOnSync === 'once' && syncForCurrentSelection.mock.calls.length === 1)) {
      throw error
    }
  })
  const accountSelection = new CodexAccountSelection({
    // SAFETY: the selection unit reads only getSettings/updateSettings and mocked deps below.
    store: store as never,
    rateLimits: { refreshForCodexAccountChange } as never,
    runtimeHome: { syncForCurrentSelection } as never,
    configMirror: { safeSyncToManagedHomes: vi.fn(async () => {}) } as never,
    lifecycle: { onHostSystemDefaultSelected },
    resolveSystemDefault: () => ({
      hasAuth: false,
      authKind: 'none' as const,
      email: null,
      providerAccountId: null,
      workspaceLabel: null
    }),
    readIdentityFromHostHome: () => { throw new Error('unexpected identity file read') },
    removeManagedHome: async () => {},
    discardResetAttempts: async () => {}
  })
  return { accountSelection, selected, replacement, store, syncForCurrentSelection, error, refreshForCodexAccountChange, onHostSystemDefaultSelected }
}

describe('Ash Codex account switch failure recovery', () => {
  it('rolls back selection and re-syncs previous home when runtime sync fails', async () => {
    const h = fixture({ failOnSync: 'once' })
    await expect(h.accountSelection.select(h.replacement.id)).rejects.toBe(h.error)
    expect(h.store.getSettings().activeCodexManagedAccountId).toBe(h.selected.id)
    expect(h.store.getSettings().activeCodexManagedAccountIdsByRuntime?.host).toBe(h.selected.id)
    expect(h.syncForCurrentSelection).toHaveBeenCalledTimes(2)
    expect(h.refreshForCodexAccountChange).not.toHaveBeenCalled()
    expect(h.onHostSystemDefaultSelected).not.toHaveBeenCalled()
  })

  it('preserves original failure and stored selection if restoration also fails', async () => {
    const h = fixture({ failOnSync: 'always' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(h.accountSelection.select(h.replacement.id)).rejects.toBe(h.error)
      expect(h.store.getSettings().activeCodexManagedAccountId).toBe(h.selected.id)
      expect(h.syncForCurrentSelection).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledWith(
        '[codex-accounts] Failed to restore previous runtime home after selection failure:',
        h.error
      )
      expect(h.refreshForCodexAccountChange).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not invoke system-default lifecycle when its routing synchronization fails', async () => {
    const h = fixture({ failOnSync: 'once' })
    await expect(h.accountSelection.select(null)).rejects.toBe(h.error)
    expect(h.store.getSettings().activeCodexManagedAccountId).toBe(h.selected.id)
    expect(h.onHostSystemDefaultSelected).not.toHaveBeenCalled()
    expect(h.refreshForCodexAccountChange).not.toHaveBeenCalled()
  })

  it('can successfully retry the same account switch after a transient failure', async () => {
    const h = fixture({ failOnSync: 'once' })
    await expect(h.accountSelection.select(h.replacement.id)).rejects.toBe(h.error)
    expect(h.store.getSettings().activeCodexManagedAccountId).toBe(h.selected.id)

    await expect(h.accountSelection.select(h.replacement.id)).resolves.toMatchObject({
      activeAccountId: h.replacement.id
    })
    expect(h.store.getSettings().activeCodexManagedAccountIdsByRuntime?.host).toBe(
      h.replacement.id
    )
    expect(h.syncForCurrentSelection).toHaveBeenCalledTimes(3)
    expect(h.refreshForCodexAccountChange).toHaveBeenCalledTimes(1)
  })

  it('does not change the host selection after a failed WSL-lane reset', async () => {
    const h = fixture({ failOnSync: 'once', wsl: true })
    await expect(h.accountSelection.select(null, { runtime: 'wsl', wslDistro: 'Ubuntu' })).rejects.toBe(h.error)
    expect(h.store.getSettings().activeCodexManagedAccountId).toBe(h.selected.id)
    expect(h.store.getSettings().activeCodexManagedAccountIdsByRuntime?.wsl.Ubuntu).toBe(h.replacement.id)
    expect(h.onHostSystemDefaultSelected).not.toHaveBeenCalled()
  })

  it('still updates selection and refreshes only after a successful sync', async () => {
    const h = fixture()
    await expect(h.accountSelection.select(null)).resolves.toMatchObject({ activeAccountId: null })
    expect(h.store.getSettings().activeCodexManagedAccountId).toBeNull()
    expect(h.onHostSystemDefaultSelected).toHaveBeenCalledTimes(1)
    expect(h.refreshForCodexAccountChange).toHaveBeenCalledTimes(1)
    expect(h.syncForCurrentSelection).toHaveBeenCalledTimes(1)
  })
})
