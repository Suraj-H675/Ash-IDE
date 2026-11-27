import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  partitions: new Map<string, string>(),
  resolvePartition: vi.fn(
    (id: string | null) => mocks.partitions.get(id ?? 'default') ?? 'persist:default-fixture'
  ),
  resolveKnownPartition: vi.fn((id: string | null) => mocks.partitions.get(id ?? 'default') ?? null)
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
    handle: (channel: string, handler: unknown) => mocks.handlers.set(channel, handler)
  },
  BrowserWindow: {}
}))
vi.mock('../../browser/sessions/browser-session-registry', () => ({
  browserSessionRegistry: {
    resolvePartition: mocks.resolvePartition,
    resolveKnownPartition: mocks.resolveKnownPartition
  }
}))
vi.mock('./browser-renderer-trust', () => ({
  isTrustedBrowserRenderer: (sender: { trusted: boolean }) => sender.trusted
}))
vi.mock('../../browser/cookies/browser-google-cookie-clear-target', () => ({
  retainLocalGoogleCookieClearTarget: vi.fn()
}))
vi.mock('./browser-google-cookie-clear-ipc', () => ({ registerGoogleCookieClearHandlers: vi.fn() }))
vi.mock('./browser-client-host-cookie-import-ipc', () => ({
  registerClientHostCookieImportHandlers: vi.fn()
}))
vi.mock('../../browser/client-hosts/lifecycle/paired-runtime-browser-client-host-runtime', () => ({
  getPairedRuntimeBrowserClientRouteIdentity: vi.fn()
}))
vi.mock('../../browser/cookies/browser-cookie-import', () => ({
  pickCookieFile: vi.fn(),
  importCookiesFromFile: vi.fn(),
  detectInstalledBrowsers: vi.fn(),
  selectBrowserProfile: vi.fn(),
  importCookiesFromBrowser: vi.fn()
}))
vi.mock('../../browser/sessions/browser-managed-session-profiles', () => ({
  ensureManagedBrowserProfile: vi.fn()
}))
vi.mock('../../browser/identity/browser-identity-mode-store', () => ({
  getBrowserIdentityModeStatus: vi.fn(),
  setBrowserIdentityMode: vi.fn()
}))
vi.mock('../../browser/site-settings/browser-site-permission-store', () => ({
  listBrowserSitePermissions: vi.fn(),
  setBrowserSitePermissionDecisions: vi.fn()
}))

import { registerBrowserSessionProfileHandlers } from './browser-session-profile-ipc'

function resolve(args: unknown, trusted = true): string | null {
  const handler = mocks.handlers.get('browser:session:resolvePartition') as (
    event: unknown,
    args: unknown
  ) => string | null
  return handler({ sender: { trusted } }, args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.partitions.clear()
  mocks.partitions.set('default', 'persist:default-fixture')
  mocks.partitions.set('isolated', 'persist:isolated-fixture')
  registerBrowserSessionProfileHandlers()
})

describe('browser profile partition IPC', () => {
  it('resolves only the explicitly selected existing profile or explicit null default', () => {
    expect(resolve({ profileId: null })).toBe('persist:default-fixture')
    expect(resolve({ profileId: 'default' })).toBe('persist:default-fixture')
    expect(resolve({ profileId: 'isolated' })).toBe('persist:isolated-fixture')
    mocks.partitions.delete('isolated')
    expect(resolve({ profileId: 'isolated' })).toBeNull()
    expect(resolve({ profileId: 'missing' })).toBeNull()
    expect(mocks.resolvePartition).not.toHaveBeenCalled()
  })

  it('does not interpret malformed input as consent to use the default profile', () => {
    for (const args of [
      undefined,
      null,
      {},
      { profileId: '' },
      { profileId: 0 },
      { profileId: false }
    ]) {
      expect(resolve(args)).toBeNull()
    }
    expect(mocks.resolveKnownPartition).not.toHaveBeenCalled()
  })

  it('rejects untrusted callers without consulting the registry', () => {
    expect(resolve({ profileId: null }, false)).toBeNull()
    expect(resolve({ profileId: 'isolated' }, false)).toBeNull()
    expect(mocks.resolveKnownPartition).not.toHaveBeenCalled()
    expect(mocks.resolvePartition).not.toHaveBeenCalled()
  })
})
