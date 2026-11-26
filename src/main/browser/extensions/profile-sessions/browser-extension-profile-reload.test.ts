import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extensionId: 'reload-test-extension',
  enabled: true,
  load: vi.fn(),
  unload: vi.fn()
}))

vi.mock('../../sessions/browser-session-registry', () => ({
  browserSessionRegistry: {
    listProfiles: () => [{ id: 'profile-a' }],
    getEnabledExtensionIds: () => (mocks.enabled ? [mocks.extensionId] : [])
  }
}))
vi.mock('../installation/browser-extension-load-directory', () => ({
  prepareBrowserExtensionDirectory: vi.fn(async () => undefined)
}))
vi.mock('./browser-extension-session-loader', () => ({
  getBrowserExtensionSessionForProfile: () => ({}),
  loadBrowserExtensionIntoProfile: mocks.load,
  unloadBrowserExtensionFromProfile: mocks.unload
}))

import type { InstalledBrowserExtension } from '../../../../shared/browser/extensions/browser-extension-types'
import { BrowserExtensionLoadCancelledError } from './browser-extension-profile-loads'
import { reloadBrowserExtensionWhereEnabled } from './browser-extension-profile-reload'

const extension = {
  id: mocks.extensionId,
  version: '1.0.0'
} as InstalledBrowserExtension

beforeEach(() => {
  mocks.enabled = true
  vi.clearAllMocks()
})

describe('browser extension reload failures', () => {
  it('propagates restore failure after the extension is disabled', async () => {
    const failure = new Error('native content script restore failed')
    mocks.load.mockImplementation(async () => {
      mocks.enabled = false
      throw failure
    })

    await expect(reloadBrowserExtensionWhereEnabled(extension)).rejects.toBe(failure)
  })

  it('suppresses only a cancellation caused by an actual disable', async () => {
    mocks.load.mockImplementation(async () => {
      mocks.enabled = false
      throw new BrowserExtensionLoadCancelledError()
    })

    await expect(reloadBrowserExtensionWhereEnabled(extension)).resolves.toBeUndefined()
  })
})
