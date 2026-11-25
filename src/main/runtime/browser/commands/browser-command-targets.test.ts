import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserError } from '../../../browser/browser-error'
import type { BrowserWindow } from 'electron'
import type { AgentBrowserBridge } from '../../../browser/agent-browser/agent-browser-bridge'
import type { BrowserBackend } from '../../../browser/browser-backend'
import type { RuntimeBrowserCommandHost } from './browser-command-contracts'
import { RuntimeBrowserCommandTargets } from './browser-command-targets'

const mocks = vi.hoisted(() => ({
  fromId: vi.fn(),
  waitForFirstLoad: vi.fn(async () => {}),
  waitForNextRegistration: vi.fn(async () => {}),
  waitForRegistration: vi.fn(async () => {}),
  waitForWorktreeRegistration: vi.fn(async () => {}),
  mainWindowReady: vi.fn(async () => {})
}))

vi.mock('electron', () => ({ webContents: { fromId: mocks.fromId } }))
vi.mock('../../../ipc/browser/browser-tab-registration-wait', () => ({
  waitForTabFirstLoad: mocks.waitForFirstLoad,
  waitForNextTabRegistration: mocks.waitForNextRegistration,
  waitForTabRegistration: mocks.waitForRegistration,
  waitForWorktreeTabRegistration: mocks.waitForWorktreeRegistration
}))
vi.mock('../../../browser/guest-lifecycle/browser-main-window-readiness', () => ({
  whenBrowserMainWindowReady: mocks.mainWindowReady
}))

const pageId = 'stable-page-id'

function createTargetHarness(options: {
  hasWindow: boolean
  ownerWebContentsId: number | null
  bridgeWebContentsId: number | null
  start?: () => Promise<boolean>
  hasSavedPage?: boolean
}) {
  const guest = { isDestroyed: () => false, getURL: () => 'https://example.test' }
  mocks.fromId.mockImplementation((id: number) =>
    id === options.bridgeWebContentsId ? guest : null
  )
  const fakeWindow = { webContents: { send: vi.fn() } }
  const window = fakeWindow as unknown as BrowserWindow
  const browserManagerBridge = {
    getRegisteredTabs: vi.fn(() =>
      options.bridgeWebContentsId === null
        ? new Map<string, number>()
        : new Map([[pageId, options.bridgeWebContentsId]])
    ),
    getActivePageId: vi.fn(() => (options.bridgeWebContentsId === null ? null : pageId))
  }
  const backend = {
    createTab: vi.fn(),
    closeTab: vi.fn(),
    ownsTab: vi.fn(() => options.ownerWebContentsId !== null),
    getWebContentsId: vi.fn(() => options.ownerWebContentsId)
  }
  const serveBrowserTabs = {
    opened: vi.fn(),
    start: vi.fn(options.start ?? (async () => false)),
    hasStartable: vi.fn(() => options.hasSavedPage ?? false),
    hasSavedPage: vi.fn(() => options.hasSavedPage ?? false)
  }
  const host = {
    getAgentBrowserBridge: () => browserManagerBridge as unknown as AgentBrowserBridge,
    resolveWorkspaceSelector: async (selector: string) => ({ id: selector }),
    getAuthoritativeWindow: () => window,
    getAvailableAuthoritativeWindow: () => (options.hasWindow ? window : null),
    getOffscreenBrowserBackend: () =>
      options.hasWindow ? null : (backend as unknown as BrowserBackend),
    getInstalledOffscreenBrowserBackend: () => backend as unknown as BrowserBackend,
    retireRuntimeOwnedBrowserSessionTab: vi.fn(() => false),
    serveBrowserTabs
  } satisfies Pick<
    RuntimeBrowserCommandHost,
    | 'getAgentBrowserBridge'
    | 'resolveWorkspaceSelector'
    | 'getAuthoritativeWindow'
    | 'getAvailableAuthoritativeWindow'
    | 'getOffscreenBrowserBackend'
    | 'getInstalledOffscreenBrowserBackend'
    | 'retireRuntimeOwnedBrowserSessionTab'
    | 'serveBrowserTabs'
  >
  return {
    targets: new RuntimeBrowserCommandTargets(host),
    host,
    backend,
    browserManagerBridge,
    window: fakeWindow
  }
}

describe('RuntimeBrowserCommandTargets', () => {
  beforeEach(() => {
    mocks.fromId.mockReset()
    mocks.waitForFirstLoad.mockClear()
    mocks.waitForNextRegistration.mockClear()
    mocks.waitForRegistration.mockClear()
    mocks.waitForWorktreeRegistration.mockClear()
    mocks.mainWindowReady.mockClear()
  })

  it('moves commands from a hidden owner to the renderer before resolving the page', async () => {
    const harness = createTargetHarness({
      hasWindow: true,
      ownerWebContentsId: 111,
      bridgeWebContentsId: 111,
      hasSavedPage: true
    })
    const replacementGuest = { isDestroyed: () => false, getURL: () => 'https://example.test' }
    mocks.fromId.mockImplementation((id: number) =>
      id === 111 || id === 222 ? replacementGuest : null
    )
    harness.window.webContents.send.mockImplementation(() => {
      harness.browserManagerBridge.getRegisteredTabs.mockReturnValue(new Map([[pageId, 222]]))
      harness.backend.getWebContentsId.mockReturnValue(null)
    })

    await expect(harness.targets.resolveBrowserCommandTarget({ page: pageId })).resolves.toEqual({
      worktreeId: undefined,
      browserPageId: pageId
    })
    expect(mocks.waitForNextRegistration).toHaveBeenCalledWith(pageId, 8_000)
    expect(mocks.waitForRegistration).not.toHaveBeenCalled()
    expect(harness.window.webContents.send).toHaveBeenCalledWith('browser:activateView', {
      browserPageId: pageId
    })
    expect(harness.targets.resolveBrowserPageWebContents(undefined, pageId).webContents).toBe(
      replacementGuest
    )
  })

  it('returns a truthful unsupported error for a saved page without a windowless backend', async () => {
    const harness = createTargetHarness({
      hasWindow: false,
      ownerWebContentsId: null,
      bridgeWebContentsId: null,
      hasSavedPage: true
    })

    await expect(
      harness.targets.resolveBrowserCommandTarget({ page: pageId })
    ).rejects.toMatchObject<Partial<BrowserError>>({
      code: 'browser_error',
      message: 'This host does not support browser panes.'
    })
  })

  it('propagates saved-page restore failures instead of hiding owner/profile errors', async () => {
    const failure = new BrowserError('invalid_argument', 'Browser profile missing was not found')
    const harness = createTargetHarness({
      hasWindow: false,
      ownerWebContentsId: null,
      bridgeWebContentsId: null,
      hasSavedPage: true,
      start: async () => {
        throw failure
      }
    })

    await expect(harness.targets.resolveBrowserCommandTarget({ page: pageId })).rejects.toBe(
      failure
    )
  })

  it('leaves visible renderer pages on their existing command path', async () => {
    const harness = createTargetHarness({
      hasWindow: true,
      ownerWebContentsId: null,
      bridgeWebContentsId: 222
    })

    await expect(harness.targets.resolveBrowserCommandTarget({ page: pageId })).resolves.toEqual({
      worktreeId: undefined,
      browserPageId: pageId
    })
    expect(harness.window.webContents.send).not.toHaveBeenCalled()
    expect(mocks.waitForNextRegistration).not.toHaveBeenCalled()
  })
})
