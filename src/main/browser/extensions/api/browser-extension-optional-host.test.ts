import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserExtensionCaller } from '../api-runtime/browser-extension-namespace-registry'
import { getBrowserExtensionNamespace } from '../api-runtime/browser-extension-namespace-registry'
import { browserExtensionHostPatternsInSession, registerPermissionsNamespace } from './permissions'
import { DnrExtensionHostAccess } from '../permissions/browser-extension-request-host-access'
import { setBrowserExtensionSupportEnabled } from '../browser-extension-support'

const mocks = vi.hoisted(() => ({
  state: { grantedPermissions: [] as string[], grantedOrigins: ['https://optional.example/*'] },
  prompt: vi.fn(async () => true),
  update: vi.fn(),
  emit: vi.fn(),
  controller: new AbortController()
}))
vi.mock('../api-runtime/browser-extension-api-host', () => ({
  emitBrowserExtensionEvent: mocks.emit,
  getBrowserExtensionProfileIdForSession: () => 'profile-a'
}))
vi.mock('../permissions/browser-extension-permission-prompt', () => ({
  askToGrantBrowserExtensionPermissions: mocks.prompt
}))
vi.mock('../profile-storage/browser-extension-profile-state-store', () => ({
  getBrowserExtensionProfileStateStore: () => ({
    read: () => mocks.state,
    update: mocks.update,
    revision: 0
  })
}))
vi.mock('../api-runtime/browser-extension-contexts', () => ({ getHostSessionState: () => ({}) }))
vi.mock('../api-runtime/browser-extension-context-lifetime', () => ({
  getBrowserExtensionContextSignal: () => mocks.controller.signal
}))
vi.mock('../declarative-net-request/session/browser-extension-dnr-session', () => ({
  getDnrSessionRuntime: () => undefined
}))
vi.mock('../browser-extension-web-request', () => ({ observeBrowserExtensionWebRequests: vi.fn() }))
vi.mock('../permissions/browser-extension-active-tab', () => ({
  browserExtensionActiveTabCovers: () => false
}))

const required = 'https://required.example/*'
const optional = 'https://optional.example/*'
const extension = {
  id: 'fixture-extension',
  manifest: {
    host_permissions: [required],
    optional_host_permissions: [optional],
    optional_permissions: ['bookmarks']
  }
} as unknown as Electron.Extension
const caller: BrowserExtensionCaller = {
  browserProfileId: 'profile-a',
  extension,
  session: {} as Electron.Session,
  userGesture: true
}
function call(method: string, ...args: unknown[]) {
  return getBrowserExtensionNamespace('permissions')!.methods[method].invoke(caller, args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = { grantedPermissions: [], grantedOrigins: [optional] }
  mocks.update.mockImplementation((_profile, _extension, change) => {
    mocks.state = change(mocks.state)
  })
  setBrowserExtensionSupportEnabled(true)
  registerPermissionsNamespace()
})

describe('optional native host authorization containment', () => {
  it('does not promote old shim-only grants to effective native host authority', () => {
    expect(call('contains', { origins: [optional] })).toBe(false)
    expect(call('getAll')).toEqual({ permissions: [], origins: [required] })
    expect(browserExtensionHostPatternsInSession(extension, caller.session)).toEqual([required])
    const dnr = new DnrExtensionHostAccess('profile-a', extension.id, extension.manifest)
    expect(dnr.access('https://optional.example/page', null, -1)).toBe('denied')
    expect(dnr.access('https://required.example/page', null, -1)).toBe('allowed')
    expect(mocks.state.grantedOrigins).toEqual([optional])
  })

  it('rejects a new or previously stored optional host request without granting a mixed API request', async () => {
    for (const origins of [[optional], ['https://optional.example/specific']]) {
      await expect(
        Promise.resolve(call('request', { origins, permissions: ['bookmarks'] }))
      ).rejects.toThrow('Optional host')
    }
    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.emit).not.toHaveBeenCalled()
    expect(mocks.state.grantedPermissions).toEqual([])
  })

  it('retains required host access and optional API permission requests independently', async () => {
    await expect(Promise.resolve(call('request', { origins: [required] }))).resolves.toBe(true)
    expect(mocks.prompt).not.toHaveBeenCalled()
    await expect(Promise.resolve(call('request', { permissions: ['bookmarks'] }))).resolves.toBe(
      true
    )
    expect(mocks.prompt).toHaveBeenCalledOnce()
    expect(call('contains', { permissions: ['bookmarks'] })).toBe(true)
    expect(call('contains', { origins: [optional] })).toBe(false)
  })
})
