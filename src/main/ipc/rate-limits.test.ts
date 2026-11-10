import { afterEach, expect, it, vi } from 'vitest'
import { createEmptyRateLimitState } from '../../shared/rate-limit-state-factory'
import type { RateLimitService } from '../rate-limits/service'
import type { CodexAccountService } from '../codex-accounts/service'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipc.handlers.set(channel, handler)
    })
  }
}))

import { registerRateLimitHandlers } from './rate-limits'

afterEach(() => {
  ipc.handlers.clear()
  vi.restoreAllMocks()
})

it('registers retained usage IPC and routes reads and explicit actions to injected services', async () => {
  const snapshot = createEmptyRateLimitState({
    claudeTarget: { runtime: 'wsl', wslDistro: 'Ubuntu-24.04' },
    codexTarget: { runtime: 'host', wslDistro: null }
  })
  const rateLimits = {
    getState: vi.fn(() => snapshot),
    refresh: vi.fn(),
    refreshCodexForTarget: vi.fn(),
    refreshClaudeForTarget: vi.fn(),
    fetchInactiveClaudeAccountsOnOpen: vi.fn(),
    fetchInactiveCodexAccountsOnOpen: vi.fn(),
    refreshGrok: vi.fn()
  } as unknown as RateLimitService
  const codexAccounts = {
    consumeCurrentRateLimitResetCredit: vi.fn()
  } as unknown as CodexAccountService

  registerRateLimitHandlers(rateLimits, codexAccounts)

  expect([...ipc.handlers.keys()]).toEqual([
    'rateLimits:get',
    'rateLimits:refresh',
    'rateLimits:refreshCodexForTarget',
    'rateLimits:consumeCodexResetCredit',
    'rateLimits:refreshClaudeForTarget',
    'rateLimits:fetchInactiveClaudeAccounts',
    'rateLimits:fetchInactiveCodexAccounts',
    'rateLimits:refreshGrok'
  ])
  expect(ipc.handlers.get('rateLimits:get')?.()).toBe(snapshot)
  expect(snapshot).toMatchObject({
    claudeTarget: { runtime: 'wsl', wslDistro: 'Ubuntu-24.04' },
    codexTarget: { runtime: 'host' },
    claude: null,
    codex: null
  })
  expect(rateLimits.getState).toHaveBeenCalledOnce()
  expect(rateLimits.refresh).not.toHaveBeenCalled()
  expect(rateLimits.refreshCodexForTarget).not.toHaveBeenCalled()
  expect(rateLimits.refreshClaudeForTarget).not.toHaveBeenCalled()
  expect(rateLimits.fetchInactiveClaudeAccountsOnOpen).not.toHaveBeenCalled()
  expect(rateLimits.fetchInactiveCodexAccountsOnOpen).not.toHaveBeenCalled()
  expect(rateLimits.refreshGrok).not.toHaveBeenCalled()

  const target = { runtime: 'wsl', wslDistro: 'Ubuntu-24.04' } as const
  await ipc.handlers.get('rateLimits:refresh')?.()
  await ipc.handlers.get('rateLimits:refreshClaudeForTarget')?.({}, target)
  await ipc.handlers.get('rateLimits:consumeCodexResetCredit')?.()
  expect(rateLimits.refresh).toHaveBeenCalledOnce()
  expect(rateLimits.refreshClaudeForTarget).toHaveBeenCalledWith(target)
  expect(codexAccounts.consumeCurrentRateLimitResetCredit).toHaveBeenCalledOnce()
})
