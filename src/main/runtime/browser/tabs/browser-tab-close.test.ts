import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { BrowserError } from '../../../browser/browser-error'
import type { BrowserBackend } from '../../../browser/browser-backend'
import type { AgentBrowserBridge } from '../../../browser/agent-browser/agent-browser-bridge'
import { RuntimeBrowserTabClose } from './browser-tab-close'

const mocks = vi.hoisted(() => ({
  closePopupPage: vi.fn(async () => false),
  getWorktreeIdForTab: vi.fn(() => 'workspace'),
  rendererClose: vi.fn(async () => {}),
  ready: vi.fn()
}))
vi.mock('../../../browser/browser-manager', () => ({ browserManager: mocks }))
vi.mock('../../../browser/guest-lifecycle/browser-main-window-readiness', () => ({
  whenBrowserMainWindowReady: mocks.ready
}))
vi.mock('./browser-tab-renderer-close', () => ({ closeBrowserTabInRenderer: mocks.rendererClose }))
vi.mock('../client-pages/browser-client-page-close', () => ({
  resolveClientPageToClose: vi.fn(async () => undefined)
}))

const page = 'hidden-page'
function harness() {
  const win = { isDestroyed: () => false } as BrowserWindow
  let owner: number | null = 11
  let registered = new Map([[page, 11]])
  const closeTab = vi.fn(async () => {
    owner = null
    registered.delete(page)
  })
  const retire = vi.fn(() => true)
  const backend = { closeTab, getWebContentsId: () => owner } as unknown as BrowserBackend
  const bridge = {
    getRegisteredTabs: (scope?: string) =>
      !scope || scope === 'workspace' ? registered : new Map(),
    getActivePageId: () => page
  } as unknown as AgentBrowserBridge
  const host = {
    getAgentBrowserBridge: () => bridge,
    resolveWorkspaceSelector: async (id: string) => ({ id }),
    getAvailableAuthoritativeWindow: () => win,
    getAuthoritativeWindow: () => win,
    getOffscreenBrowserBackend: () => null,
    getInstalledOffscreenBrowserBackend: () => backend,
    retireRuntimeOwnedBrowserSessionTab: retire
  } as unknown as ConstructorParameters<typeof RuntimeBrowserTabClose>[1]
  const closer = new RuntimeBrowserTabClose(
    {} as ConstructorParameters<typeof RuntimeBrowserTabClose>[0],
    host,
    {} as ConstructorParameters<typeof RuntimeBrowserTabClose>[2]
  )
  mocks.ready.mockResolvedValue(win)
  return {
    close: (worktree?: string) => closer.browserTabClose({ page, worktree }),
    closeTab,
    retire,
    win,
    replace: () => {
      owner = 22
      registered = new Map([[page, 22]])
    },
    unregister: () => {
      registered = new Map()
    }
  }
}
describe('closing a retained offscreen owner while the desktop returns', () => {
  beforeEach(() => {
    mocks.rendererClose.mockReset()
    mocks.rendererClose.mockResolvedValue(undefined)
    mocks.ready.mockReset()
  })
  it('honors the renderer close then destroys the original hidden owner even after row removal', async () => {
    const f = harness()
    mocks.rendererClose.mockImplementation(async () => {
      f.unregister()
    })
    await expect(f.close()).resolves.toEqual({ closed: true })
    expect(mocks.rendererClose).toHaveBeenCalledWith(f.win, page, undefined)
    expect(f.closeTab).toHaveBeenCalledWith(page)
    expect(f.retire).not.toHaveBeenCalled()
  })
  it('retires a scoped offscreen-only page when the ready renderer has no row', async () => {
    const f = harness()
    mocks.rendererClose.mockRejectedValue(new BrowserError('browser_tab_not_found', 'missing row'))
    await expect(f.close()).resolves.toEqual({ closed: true })
    expect(f.closeTab).toHaveBeenCalledWith(page)
    expect(f.retire).toHaveBeenCalledWith('workspace', page, true)
  })
  it('preserves the owner after a pinned close refusal', async () => {
    const f = harness()
    mocks.rendererClose.mockRejectedValue(new Error('Pinned tab'))
    await expect(f.close()).rejects.toThrow('Pinned tab')
    expect(f.closeTab).not.toHaveBeenCalled()
  })
  it('does not retire a newer incarnation after a missing-row reply', async () => {
    const f = harness()
    mocks.rendererClose.mockImplementation(async () => {
      f.replace()
      throw new BrowserError('browser_tab_not_found', 'missing row')
    })
    await expect(f.close()).rejects.toMatchObject({ code: 'browser_tab_not_found' })
    expect(f.closeTab).not.toHaveBeenCalled()
    expect(f.retire).not.toHaveBeenCalled()
  })
  it('does not erase a saved row acquired by a new owner during asynchronous retirement', async () => {
    const f = harness()
    mocks.rendererClose.mockRejectedValue(new BrowserError('browser_tab_not_found', 'missing row'))
    f.closeTab.mockImplementationOnce(async () => {
      f.replace()
    })
    await expect(f.close()).rejects.toMatchObject({ code: 'browser_tab_not_found' })
    expect(f.closeTab).toHaveBeenCalledWith(page)
    expect(f.retire).not.toHaveBeenCalled()
  })

  it('does not retire a hidden owner outside the requested workspace', async () => {
    const f = harness()
    mocks.rendererClose.mockRejectedValue(
      new BrowserError('browser_tab_not_found', 'wrong workspace')
    )
    await expect(f.close('other')).rejects.toMatchObject({ code: 'browser_tab_not_found' })
    expect(f.closeTab).not.toHaveBeenCalled()
  })
  it('does not interpret a not-yet-restored renderer as a missing tab', async () => {
    const f = harness()
    mocks.ready.mockResolvedValue(null)
    await expect(f.close()).rejects.toMatchObject({ code: 'browser_error' })
    expect(mocks.rendererClose).not.toHaveBeenCalled()
    expect(f.closeTab).not.toHaveBeenCalled()
  })
})
