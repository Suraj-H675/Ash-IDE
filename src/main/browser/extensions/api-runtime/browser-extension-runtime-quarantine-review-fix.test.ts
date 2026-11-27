import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeExtensionOrigin } from '../../../../shared/browser/extensions/browser-extension-url'
import type { FrameContext } from './browser-extension-frame-lifetime'
import type { HostSessionState, WorkerContext } from './browser-extension-contexts'

const mocks = vi.hoisted(() => ({
  handler: async (_event: unknown, _request: unknown): Promise<unknown> => undefined,
  frameApi: vi.fn(async () => ({ ok: true, value: 'frame api ran' })),
  hostState: {
    browserProfileId: 'profile-a',
    frames: new Map<string, FrameContext>(),
    workers: new Map<string, WorkerContext>()
  },
  frames: new Map<string, object>(),
  extensions: new Map<string, Electron.Extension>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: (_channel: string, handler: typeof mocks.handler) => {
      mocks.handler = handler
    }
  },
  webFrameMain: {
    fromId: (processId: number, routingId: number) =>
      mocks.frames.get(`${processId}:${routingId}`) ?? null
  }
}))
vi.mock('./browser-extension-contexts', () => ({
  ensureHostSessionState: vi.fn(() => mocks.hostState),
  ensureWorkerContext: vi.fn(),
  forgetExtensionContexts: vi.fn(),
  forgetHostSession: vi.fn(),
  getHostSessionState: vi.fn(() => mocks.hostState),
  dispatchBrowserExtensionEvent: vi.fn(),
  dispatchToWorkerWhenListening: vi.fn()
}))
vi.mock('./browser-extension-api-request', () => ({
  handleBrowserExtensionApiRequest: mocks.frameApi
}))
vi.mock('./browser-extension-namespace-registry', () => ({
  extensionHasNamespacePermission: vi.fn(() => true),
  getBrowserExtensionNamespace: vi.fn(() => ({ permission: null }))
}))

import { installBrowserExtensionApiHost } from './browser-extension-api-host'
import { dispatchBrowserExtensionEvent } from './browser-extension-event-dispatch'
import { handleBrowserExtensionWorkerRequest } from './browser-extension-worker-api-host'
import { quarantineBrowserExtensionRuntime } from './browser-extension-runtime-quarantine'

const quarantinedId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const healthyId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function createSession(): Electron.Session {
  const session = {
    extensions: {
      getExtension: (id: string) => mocks.extensions.get(id),
      getAllExtensions: () => [...mocks.extensions.values()],
      on: vi.fn()
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fixture only uses the Electron.Session extension registry and has no native browser execution.
  return session as unknown as Electron.Session
}

function extensionWithId(id: string): Electron.Extension {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: API host identity checks read only id and manifest from this fixture.
  return { id, manifest: {} } as Electron.Extension
}

function frameWithIdentity(
  url: string,
  processId: number,
  routingId: number,
  send: () => void
): Electron.WebFrameMain {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: event-dispatch tests use only frame identity, URL, destroy state, and send from this mocked frame.
  return {
    url,
    processId,
    routingId,
    isDestroyed: () => false,
    send
  } as unknown as Electron.WebFrameMain
}

function callerEvent(session: Electron.Session, extensionId: string) {
  const origin = getChromeExtensionOrigin(extensionId)
  const frame = {
    url: `${origin}/page.html`,
    origin,
    isDestroyed: () => false
  }
  return { sender: { id: extensionId.length, session }, senderFrame: frame }
}

beforeEach(() => {
  mocks.hostState = {
    browserProfileId: 'profile-a',
    frames: new Map(),
    workers: new Map()
  }
  mocks.frames.clear()
  mocks.extensions.clear()
  mocks.frameApi.mockClear()
  mocks.extensions.set(quarantinedId, extensionWithId(quarantinedId))
  mocks.extensions.set(healthyId, extensionWithId(healthyId))
})

describe('failed native unload quarantine', () => {
  it('blocks Ash frame APIs and still permits an unaffected extension in the session', async () => {
    const session = createSession()
    quarantineBrowserExtensionRuntime(
      session,
      quarantinedId,
      'Could not confirm native unload; the extension may remain active.'
    )
    installBrowserExtensionApiHost()
    await expect(mocks.handler(callerEvent(session, quarantinedId), {})).resolves.toEqual({
      ok: false,
      error: 'Not an extension context'
    })
    expect(mocks.frameApi).not.toHaveBeenCalled()

    await expect(mocks.handler(callerEvent(session, healthyId), {})).resolves.toEqual({
      ok: true,
      value: 'frame api ran'
    })
    expect(mocks.frameApi).toHaveBeenCalledTimes(1)
  })

  it('stops Ash event delivery to the quarantined frame and worker only', () => {
    const session = createSession()
    const event = 'runtime.onStartup'
    const frameASend = vi.fn()
    const frameBSend = vi.fn()
    const frameA = frameWithIdentity(
      `${getChromeExtensionOrigin(quarantinedId)}/page.html`,
      10,
      11,
      frameASend
    )
    const frameB = frameWithIdentity(
      `${getChromeExtensionOrigin(healthyId)}/page.html`,
      20,
      21,
      frameBSend
    )
    mocks.frames.set('10:11', frameA)
    mocks.frames.set('20:21', frameB)
    const workerSendA = vi.fn()
    const workerSendB = vi.fn()
    const state: HostSessionState = {
      browserProfileId: 'profile-a',
      frames: new Map([
        [
          'frame-a',
          {
            extensionId: quarantinedId,
            webContentsId: 1,
            processId: 10,
            routingId: 11,
            events: new Set([event]),
            filters: new Map(),
            dispose: vi.fn()
          }
        ],
        [
          'frame-b',
          {
            extensionId: healthyId,
            webContentsId: 2,
            processId: 20,
            routingId: 21,
            events: new Set([event]),
            filters: new Map(),
            dispose: vi.fn()
          }
        ]
      ]),
      workers: new Map([
        [
          quarantinedId,
          {
            extensionId: quarantinedId,
            scope: `${getChromeExtensionOrigin(quarantinedId)}/`,
            events: new Set([event]),
            filters: new Map(),
            running: null,
            stream: { send: workerSendA, close: vi.fn() },
            queue: [],
            starting: false
          }
        ],
        [
          healthyId,
          {
            extensionId: healthyId,
            scope: `${getChromeExtensionOrigin(healthyId)}/`,
            events: new Set([event]),
            filters: new Map(),
            running: null,
            stream: { send: workerSendB, close: vi.fn() },
            queue: [],
            starting: false
          }
        ]
      ])
    }
    quarantineBrowserExtensionRuntime(session, quarantinedId, 'native unload is unconfirmed')

    dispatchBrowserExtensionEvent(
      new Map<Electron.Session, HostSessionState>([[session, state]]),
      { session },
      'runtime',
      'onStartup',
      [],
      vi.fn()
    )

    expect(frameASend).not.toHaveBeenCalled()
    expect(workerSendA).not.toHaveBeenCalled()
    expect(frameBSend).toHaveBeenCalledTimes(1)
    expect(workerSendB).toHaveBeenCalledTimes(1)
  })

  it('rejects worker bridge requests before reading a quarantined request body', async () => {
    const session = createSession()
    const request = new Request('https://worker.invalid/', {
      method: 'POST',
      body: 'payload'
    })
    Object.defineProperty(request, 'initiatorOrigin', {
      value: getChromeExtensionOrigin(quarantinedId)
    })
    quarantineBrowserExtensionRuntime(session, quarantinedId, 'native unload is unconfirmed')

    const response = await handleBrowserExtensionWorkerRequest(session, mocks.hostState, request)

    expect(response.status).toBe(403)
    expect(request.bodyUsed).toBe(false)
  })
})
