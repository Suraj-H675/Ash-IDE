import {
  attachBrowserExtensionApiHostToSession,
  forgetBrowserExtensionContexts
} from './browser-extension-api-host'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { setBrowserExtensionSupportEnabled } from '../browser-extension-support'
import {
  ensureHostSessionState,
  fenceBrowserExtensionHostSession,
  forgetHostSession,
  getHostSessionState
} from './browser-extension-contexts'
import { getBrowserExtensionContextSignal } from './browser-extension-context-lifetime'
import { handleBrowserExtensionApiRequest } from './browser-extension-api-request'
import { drainBrowserExtensionApiCalls } from './browser-extension-api-admission'
import {
  defineBrowserExtensionMethod,
  registerBrowserExtensionNamespace
} from './browser-extension-namespace-registry'

vi.mock('electron', () => ({ webFrameMain: {}, MessageChannelMain: vi.fn() }))

function fixture() {
  setBrowserExtensionSupportEnabled(true)
  const session = {} as Electron.Session
  const state = ensureHostSessionState(session, 'fixture-profile')
  const extension = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', manifest: {} } as Electron.Extension
  const request = () =>
    handleBrowserExtensionApiRequest(
      { session, extension, browserProfileId: state.browserProfileId },
      state,
      { type: 'call', namespace: 'fixture', method: 'write', args: [] },
      { kind: 'frame', webContents: {} as Electron.WebContents, frame: {} as Electron.WebFrameMain }
    )
  return { session, state, extension, request }
}
afterEach(() => {
  setBrowserExtensionSupportEnabled(false)
  vi.useRealTimers()
})

describe('extension API retirement', () => {
  it('does not unregister an unowned protocol during restart cleanup; retries a failed owned unregistration', () => {
    const sess = {
      protocol: {
        handle: vi.fn(),
        unhandle: vi.fn()
      },
      serviceWorkers: {
        on: vi.fn(),
        getAllRunning: () => ({})
      },
      extensions: { on: vi.fn() }
    }
    const session = sess as unknown as Electron.Session
    forgetBrowserExtensionContexts(session)
    expect(sess.protocol.unhandle).not.toHaveBeenCalled()
    attachBrowserExtensionApiHostToSession(session, 'retired-fixture')
    expect(sess.protocol.handle).toHaveBeenCalledOnce()
    sess.protocol.unhandle.mockImplementationOnce(() => {
      throw new Error('unhandle refused')
    })
    expect(() => forgetBrowserExtensionContexts(session)).toThrow('unhandle refused')
    forgetBrowserExtensionContexts(session)
    expect(sess.protocol.unhandle).toHaveBeenCalledTimes(2)
    forgetBrowserExtensionContexts(session)
    expect(sess.protocol.unhandle).toHaveBeenCalledTimes(2)
    attachBrowserExtensionApiHostToSession(session, 'retired-fixture')
    expect(sess.protocol.handle).toHaveBeenCalledTimes(2)
    forgetBrowserExtensionContexts(session)
  })

  it('aborts pending prompts, blocks new requests, and drains a previously admitted method', async () => {
    const { session, state, extension, request } = fixture()
    const signal = getBrowserExtensionContextSignal(state, extension.id)
    let finish!: () => void
    const write = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return 'settled'
    })
    registerBrowserExtensionNamespace('fixture', {
      methods: { write: defineBrowserExtensionMethod(z.tuple([]), write) },
      events: []
    })
    const pending = request()
    expect(write).toHaveBeenCalledOnce()
    fenceBrowserExtensionHostSession(session)
    expect(signal.aborted).toBe(true)
    expect(getBrowserExtensionContextSignal(state, extension.id).aborted).toBe(true)
    expect(getHostSessionState(session)).toBeNull()
    await expect(request()).resolves.toMatchObject({ ok: false })
    expect(write).toHaveBeenCalledOnce()
    const drained = vi.fn()
    const draining = drainBrowserExtensionApiCalls(session).then(drained)
    await Promise.resolve()
    expect(drained).not.toHaveBeenCalled()
    finish()
    await pending
    await draining
    expect(drained).toHaveBeenCalledOnce()
    forgetHostSession(session)
  })

  it('fails a stalled drain without forgetting its pending operation; retry works only after settlement', async () => {
    vi.useFakeTimers()
    const { session, request } = fixture()
    let finish!: () => void
    registerBrowserExtensionNamespace('fixture', {
      methods: {
        write: defineBrowserExtensionMethod(
          z.tuple([]),
          async () =>
            new Promise<void>((resolve) => {
              finish = resolve
            })
        )
      },
      events: []
    })
    const pending = request()
    fenceBrowserExtensionHostSession(session)
    const drain = drainBrowserExtensionApiCalls(session)
    const failed = expect(drain).rejects.toThrow('retirement timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    const second = drainBrowserExtensionApiCalls(session)
    const settled = vi.fn()
    void second.then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    finish()
    await pending
    await second
    expect(settled).toHaveBeenCalledOnce()
    forgetHostSession(session)
  })
})
