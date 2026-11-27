import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  contents: [] as Electron.WebContents[],
  status: { desiredEnabled: false, runtime: 'unload-failed' as const },
  publish: null as ((status: { desiredEnabled: boolean; runtime: string }) => void) | null,
  retry: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
    handle: (channel: string, handler: unknown) => mocks.handlers.set(channel, handler)
  },
  webContents: { getAllWebContents: () => mocks.contents }
}))
vi.mock('../../browser/extensions/browser-extension-support', () => ({
  getBrowserExtensionSupportStatus: () => mocks.status,
  onBrowserExtensionSupportStatusChanged: (listener: typeof mocks.publish) => {
    mocks.publish = listener
    return () => {
      mocks.publish = null
    }
  }
}))
vi.mock('../../browser/extensions/browser-extension-startup', () => ({
  retryBrowserExtensionSupportTransition: mocks.retry
}))
vi.mock('./browser-renderer-trust', () => ({
  isTrustedBrowserRenderer: (sender: { trusted?: boolean }) => sender.trusted === true
}))

import { registerBrowserExtensionSupportHandlers } from './browser-extension-support'
import { BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL } from '../../../shared/browser/extensions/browser-extension-types'

function registeredHandler(channel: string): (event: unknown) => unknown {
  const handler = mocks.handlers.get(channel)
  expect(typeof handler).toBe('function')
  return handler as (event: unknown) => unknown
}

function contents(trusted: boolean): Electron.WebContents {
  return {
    trusted,
    isDestroyed: () => false,
    send: vi.fn()
  } as unknown as Electron.WebContents
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.contents = []
  mocks.publish = null
  mocks.retry.mockClear()
})

describe('browser extension support IPC', () => {
  it('rejects untrusted status and retry requests without starting recovery', async () => {
    registerBrowserExtensionSupportHandlers()
    const untrusted = { sender: { trusted: false } }

    expect(registeredHandler('browserExtensions:supportStatus')(untrusted)).toBeNull()
    await expect(
      registeredHandler('browserExtensions:retrySupportTransition')(untrusted)
    ).resolves.toBeNull()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('returns process status and publishes changes only to trusted renderers', async () => {
    const trustedRenderer = contents(true)
    const untrustedRenderer = contents(false)
    mocks.contents = [trustedRenderer, untrustedRenderer]
    registerBrowserExtensionSupportHandlers()

    expect(
      registeredHandler('browserExtensions:supportStatus')({ sender: { trusted: true } })
    ).toEqual({ desiredEnabled: false, runtime: 'unload-failed' })
    expect(mocks.publish).not.toBeNull()
    mocks.publish?.({ desiredEnabled: false, runtime: 'disabled' })
    expect(trustedRenderer.send).toHaveBeenCalledWith(BROWSER_EXTENSION_SUPPORT_CHANGED_CHANNEL, {
      desiredEnabled: false,
      runtime: 'disabled'
    })
    expect(untrustedRenderer.send).not.toHaveBeenCalled()
  })

  it('allows a trusted renderer to retry and returns sanitized runtime state', async () => {
    registerBrowserExtensionSupportHandlers()
    await expect(
      registeredHandler('browserExtensions:retrySupportTransition')({ sender: { trusted: true } })
    ).resolves.toEqual({ desiredEnabled: false, runtime: 'unload-failed' })
    expect(mocks.retry).toHaveBeenCalledOnce()
  })
})
