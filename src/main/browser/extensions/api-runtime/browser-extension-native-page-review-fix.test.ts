import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadURL: vi.fn(),
  executeJavaScript: vi.fn(),
  destroy: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { executeJavaScript: mocks.executeJavaScript }

    constructor(_options: unknown) {}

    loadURL = mocks.loadURL

    destroy = mocks.destroy
  }
}))

import { runBrowserExtensionNativePage } from './browser-extension-native-page'

describe('native extension page cancellation', () => {
  beforeEach(() => {
    mocks.loadURL.mockReset()
    mocks.executeJavaScript.mockReset()
    mocks.destroy.mockReset()
    mocks.loadURL.mockImplementation(() => new Promise<void>(() => {}))
  })

  it('destroys the hidden extension page when unload aborts its pending native operation', async () => {
    const controller = new AbortController()
    const running = runBrowserExtensionNativePage({
      session: createSession(),
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      code: 'globalThis.chrome.scripting.registerContentScripts([])',
      timeoutMs: 5_000,
      signal: controller.signal
    })
    controller.abort()

    await expect(running).rejects.toThrow('Extension context was unloaded')
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })
})

function createSession(): Electron.Session {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked BrowserWindow never calls into the supplied session.
  return {} as unknown as Electron.Session
}
