import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserSessionProfile } from '../../../shared/browser-workspace-types'

const mocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  detach: vi.fn(async () => {}),
  fenceProxy: vi.fn(async () => {}),
  retireProxy: vi.fn(async () => {}),
  applyProxy: vi.fn(async () => {}),
  invalidateProxy: vi.fn(),
  clearWebAuthn: vi.fn(),
  cancelWebAuthn: vi.fn(),
  decide: vi.fn<() => Promise<boolean>>(),
  memorySet: vi.fn(),
  memoryGet: vi.fn()
}))

vi.mock('electron', () => ({ session: { fromPartition: mocks.fromPartition } }))
vi.mock('../../network/proxy-settings', () => ({
  fenceProxySessionApplication: mocks.fenceProxy,
  retireProxySessionApplication: mocks.retireProxy,
  clearProxySessionCredentials: vi.fn()
}))
vi.mock('./browser-session-proxy', () => ({
  applyProxyToBrowserSession: mocks.applyProxy,
  invalidateBrowserSessionProxyApplication: mocks.invalidateProxy
}))
vi.mock('../browser-manager', () => ({
  browserManager: {
    installCertificateRequestGuard: vi.fn(),
    removeCertificateRequestGuard: vi.fn(),
    notifyPermissionDenied: vi.fn()
  }
}))
vi.mock('../identity/browser-session-ua', () => ({
  installBrowserSessionUserAgentPolicy: () => vi.fn()
}))
vi.mock('../identity/browser-process-user-agent', () => ({
  getBrowserProcessUserAgentIdentity: () => ({ userAgent: 'fixture' })
}))
vi.mock('../site-settings/browser-media-access', () => ({
  hasSystemMediaAccess: () => true,
  requestSystemMediaAccess: async () => true
}))
vi.mock('../site-settings/browser-session-permission-policy', () => ({
  isAutoGrantedBrowserSessionPermission: () => true
}))
vi.mock('../site-settings/browser-site-permission-prompt', () => ({
  answerBrowserLocalNetworkCheck: vi.fn(),
  browserSitePermissionRequestingOrigin: vi.fn(),
  browserSitePermissionsFor: () => ['notifications'],
  decideBrowserSitePermissions: mocks.decide,
  isBrowserSitePermissionAllowed: () => true,
  savedBrowserSitePermissions: () => ({ get: mocks.memoryGet, set: mocks.memorySet }),
  sessionBrowserSitePermissions: vi.fn()
}))
vi.mock('../webauthn/browser-webauthn-access', () => ({
  allowsBrowserWebAuthnPermission: () => false,
  clearBrowserWebAuthnAccessHandlers: mocks.clearWebAuthn,
  installBrowserWebAuthnAccessHandlers: vi.fn()
}))
vi.mock('../webauthn/browser-webauthn-account-picker', () => ({
  cancelBrowserWebAuthnAccountRequestsForSession: mocks.cancelWebAuthn
}))
vi.mock('../document-preview/doc-preview-download-block-notice', () => ({
  noticeDocPreviewDownloadBlocked: vi.fn()
}))
vi.mock('../desktop-browser-bridge/remote-cli-driven-workspaces', () => ({
  isRemoteCliDrivenGuest: () => false
}))
vi.mock('../extensions/profile-sessions/browser-extension-session-loader', () => ({
  detachBrowserExtensionsFromProfileSession: mocks.detach
}))

import { installBrowserSessionPartitionPolicies } from './browser-session-partition-policies'
import { retireDeletedBrowserSessionProfile } from './browser-session-profile-retirement'

function fixture(id: string) {
  const profile = { id, partition: `persist:retirement-fixture-${id}` } as BrowserSessionProfile
  const sess = Object.assign(new EventEmitter(), {
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {})
  })
  mocks.fromPartition.mockReturnValue(sess)
  return { profile, sess }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.detach.mockResolvedValue(undefined)
  mocks.fenceProxy.mockResolvedValue(undefined)
  mocks.retireProxy.mockResolvedValue(undefined)
  mocks.applyProxy.mockResolvedValue(undefined)
})

describe('deleted browser profile retirement', () => {
  it('revokes permissions before extension retirement and preserves storage if native unload fails', async () => {
    const { profile, sess } = fixture('failed-unload')
    await installBrowserSessionPartitionPolicies(profile)
    const nativeError = new Error('Native extension may still execute')
    mocks.detach.mockImplementationOnce(async () => {
      expect(mocks.fenceProxy).toHaveBeenCalledWith(sess)
      expect(mocks.retireProxy).not.toHaveBeenCalled()
      expect(sess.setPermissionCheckHandler.mock.lastCall?.[0]()).toBe(false)
      const callback = vi.fn()
      sess.setPermissionRequestHandler.mock.lastCall?.[0](null, 'clipboard-read', callback)
      expect(callback).toHaveBeenCalledWith(false)
      expect(sess.setDevicePermissionHandler.mock.lastCall?.[0]()).toBe(false)
      const event = { preventDefault: vi.fn() }
      sess.emit('will-download', event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      throw nativeError
    })
    await expect(retireDeletedBrowserSessionProfile(profile)).rejects.toThrow(nativeError)
    expect(mocks.fenceProxy).toHaveBeenCalledWith(sess)
    expect(mocks.retireProxy).not.toHaveBeenCalled()
    expect(mocks.invalidateProxy).toHaveBeenCalledWith(sess)
    expect(mocks.clearWebAuthn).toHaveBeenCalledWith(sess)
    expect(sess.clearStorageData).not.toHaveBeenCalled()
    expect(sess.clearCache).not.toHaveBeenCalled()
    await expect(installBrowserSessionPartitionPolicies(profile)).rejects.toThrow('retired')
    expect(sess.setPermissionCheckHandler.mock.lastCall?.[0]()).toBe(false)
  })

  it('continues other revocations and native retirement when one Electron policy setter fails', async () => {
    const { profile, sess } = fixture('failed-policy')
    await installBrowserSessionPartitionPolicies(profile)
    const failure = new Error('permission request setter failed')
    sess.setPermissionRequestHandler.mockImplementationOnce(() => {
      throw failure
    })
    await expect(retireDeletedBrowserSessionProfile(profile)).rejects.toThrow()
    expect(sess.setPermissionCheckHandler.mock.lastCall?.[0]()).toBe(false)
    expect(sess.setDevicePermissionHandler.mock.lastCall?.[0]()).toBe(false)
    const event = { preventDefault: vi.fn() }
    sess.emit('will-download', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.fenceProxy).toHaveBeenCalledWith(sess)
    expect(mocks.retireProxy).not.toHaveBeenCalled()
    expect(mocks.invalidateProxy).toHaveBeenCalledWith(sess)
    expect(mocks.detach).toHaveBeenCalledWith(profile)
    expect(sess.clearStorageData).not.toHaveBeenCalled()
    expect(sess.clearCache).not.toHaveBeenCalled()
  })

  it('does not grant a site permission from a prompt that was pending when deletion began', async () => {
    const { profile, sess } = fixture('pending-permission')
    let resolve!: (allowed: boolean) => void
    mocks.decide.mockReturnValueOnce(
      new Promise<boolean>((r) => {
        resolve = r
      })
    )
    await installBrowserSessionPartitionPolicies(profile)
    const request = sess.setPermissionRequestHandler.mock.lastCall?.[0]
    const callback = vi.fn()
    request({ id: 1, getURL: () => 'https://example.test' }, 'notifications', callback, {})
    expect(callback).not.toHaveBeenCalled()
    await retireDeletedBrowserSessionProfile(profile)
    expect(mocks.retireProxy).toHaveBeenCalledWith(sess)
    expect(mocks.retireProxy.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.detach.mock.invocationCallOrder[0]
    )
    resolve(true)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false))
    expect(sess.clearStorageData).toHaveBeenCalledOnce()
    expect(sess.clearCache).toHaveBeenCalledOnce()
  })
})
