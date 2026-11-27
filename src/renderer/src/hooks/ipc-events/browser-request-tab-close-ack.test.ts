import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBrowserRequestIpcBridge } from './browser-request-ipc-bridge'

const mocks = vi.hoisted(() => {
  const state: { current: unknown } = { current: null }
  return {
    state,
    subscribers: new Set<(...args: unknown[]) => void>(),
    guardPinnedTabClose: vi.fn(({ onClose }: { onClose: () => void; onCancel?: () => void }) =>
      onClose()
    ),
    flushRuntimeGraphSync: vi.fn(async () => {})
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mocks.state.current,
    subscribe: (listener: (...args: unknown[]) => void) => {
      mocks.subscribers.add(listener)
      return () => mocks.subscribers.delete(listener)
    }
  }
}))
vi.mock('@/components/browser-pane/host-guest/webview-registry', () => ({
  destroyPersistentWebview: vi.fn()
}))
vi.mock('../../store/pinned-tab-close-guard', () => ({
  guardPinnedTabClose: mocks.guardPinnedTabClose,
  isUnifiedTabPinned: () => false,
  resolvePinnedTabLabel: () => 'Browser'
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./browser-automation-bootstrap-lease', () => ({
  acquireBrowserAutomationBootstrapLease: vi.fn()
}))
vi.mock('./browser-tab-split-placement', () => ({
  browserTabSplitTarget: vi.fn(),
  existingBrowserPaneGroupId: vi.fn(),
  splitCallerWorktreeId: vi.fn()
}))
vi.mock('./browser-request-workspace-owner', () => ({
  findBrowserTabWorktreeId: () => 'wt-1',
  isBrowserWorkspaceOwnedByPairedServer: () => false,
  isDesktopRenderedBrowserTab: () => true,
  resolveRemoteCliBrowserWorkspace: vi.fn()
}))
vi.mock('@/runtime/sync-runtime-graph', () => ({
  flushRuntimeGraphSync: mocks.flushRuntimeGraphSync
}))

type CloseRequest = { requestId: string; tabId: string | null; worktreeId?: string }

const page = (id: string) => ({
  id,
  url: `https://${id}.example.test`,
  title: id,
  worktreeId: 'wt-1'
})

function tabBarEntry(tab: ReturnType<typeof page>) {
  return {
    browserPageId: tab.id,
    worktreeId: 'wt-1',
    title: tab.title,
    url: tab.url,
    loadError: null,
    certificateFailure: null
  }
}

function listedPageIds(tabBar: ReturnType<typeof tabBarEntry>[]) {
  // This renderer test observes the mocked publication boundary; main's
  // actual merge/list behavior is covered by the node and native fixtures.
  return tabBar.map((tab) => tab.browserPageId)
}

function registerCloseListener() {
  const listeners: { close?: (data: CloseRequest) => unknown } = {}
  const replyTabClose = vi.fn()
  vi.stubGlobal('window', {
    api: {
      ui: {
        onRequestRemoteCliBrowserScope: () => () => {},
        replyRemoteCliBrowserScope: vi.fn(),
        onRequestTabCreate: () => () => {},
        replyTabCreate: vi.fn(),
        onRequestTabSetProfile: () => () => {},
        replyTabSetProfile: vi.fn(),
        onRequestTabClose: (listener: (data: CloseRequest) => void) => {
          listeners.close = listener
          return () => {}
        },
        replyTabClose
      }
    }
  })
  registerBrowserRequestIpcBridge([])
  const close = listeners.close
  if (!close) {
    throw new Error('Browser close listener was not registered')
  }
  return { close, replyTabClose }
}

describe('browser close acknowledgment', () => {
  beforeEach(() => {
    mocks.state.current = null
    mocks.subscribers.clear()
    mocks.guardPinnedTabClose.mockReset()
    mocks.guardPinnedTabClose.mockImplementation(({ onClose }) => onClose())
    mocks.flushRuntimeGraphSync.mockReset()
    mocks.flushRuntimeGraphSync.mockResolvedValue(undefined)
  })

  it('waits until the closed page is absent from the published tab list', async () => {
    const closedPage = page('page-closed')
    const retainedPage = page('page-retained')
    const workspaceId = 'browser-workspace'
    const worktreeId = 'wt-1'
    const state = {
      browserTabsByWorktree: { [worktreeId]: [{ id: workspaceId }] },
      browserPagesByWorkspace: { [workspaceId]: [closedPage, retainedPage] },
      activeBrowserTabIdByWorktree: { [worktreeId]: workspaceId },
      activeBrowserTabId: workspaceId,
      activeWorktreeId: worktreeId,
      unifiedTabsByWorktree: {},
      closeBrowserPage: vi.fn(),
      closeBrowserTab: vi.fn()
    }
    mocks.state.current = state

    const { close, replyTabClose } = registerCloseListener()
    const publishedTabBar = [tabBarEntry(closedPage), tabBarEntry(retainedPage)]
    let finishPublication: (() => void) | undefined
    mocks.flushRuntimeGraphSync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPublication = () => {
            publishedTabBar.splice(
              0,
              publishedTabBar.length,
              ...(state.browserPagesByWorkspace[workspaceId] ?? []).map(tabBarEntry)
            )
            resolve()
          }
        })
    )
    expect(listedPageIds(publishedTabBar)).toEqual(['page-closed', 'page-retained'])
    const closeCompletion = close({
      requestId: 'close-request',
      tabId: closedPage.id,
      worktreeId
    })

    expect(state.closeBrowserPage).toHaveBeenCalledWith(closedPage.id)
    expect(replyTabClose).not.toHaveBeenCalled()

    state.browserPagesByWorkspace[workspaceId] = [retainedPage]
    for (const listener of mocks.subscribers) {
      listener(state, state)
    }
    await vi.waitFor(() => expect(mocks.flushRuntimeGraphSync).toHaveBeenCalledOnce())
    expect(replyTabClose).not.toHaveBeenCalled()
    finishPublication?.()
    await closeCompletion

    expect(replyTabClose).toHaveBeenCalledWith({ requestId: 'close-request' })
    expect(listedPageIds(publishedTabBar)).toEqual(['page-retained'])
  })

  it('waits for pinned-tab confirmation before acknowledging the close', async () => {
    const workspaceId = 'pinned-browser-workspace'
    const worktreeId = 'wt-1'
    const state = {
      browserTabsByWorktree: { [worktreeId]: [{ id: workspaceId }] },
      browserPagesByWorkspace: { [workspaceId]: [page('pinned-page')] },
      activeBrowserTabIdByWorktree: { [worktreeId]: workspaceId },
      activeBrowserTabId: workspaceId,
      activeWorktreeId: worktreeId,
      unifiedTabsByWorktree: {},
      closeBrowserPage: vi.fn(),
      closeBrowserTab: vi.fn()
    }
    state.closeBrowserTab.mockImplementation(() => {
      state.browserTabsByWorktree[worktreeId] = []
      state.browserPagesByWorkspace[workspaceId] = []
    })
    mocks.state.current = state

    let confirmClose: (() => void) | undefined
    mocks.guardPinnedTabClose.mockImplementation(({ onClose }) => {
      confirmClose = onClose
    })
    const { close, replyTabClose } = registerCloseListener()
    const closeCompletion = close({
      requestId: 'pinned-close-request',
      tabId: workspaceId,
      worktreeId
    })

    expect(state.closeBrowserTab).not.toHaveBeenCalled()
    expect(replyTabClose).not.toHaveBeenCalled()
    confirmClose?.()
    await closeCompletion

    expect(state.closeBrowserTab).toHaveBeenCalledWith(workspaceId)
    expect(mocks.flushRuntimeGraphSync).toHaveBeenCalledOnce()
    expect(replyTabClose).toHaveBeenCalledWith({ requestId: 'pinned-close-request' })
  })

  it('keeps a canceled pinned close refused', async () => {
    const workspaceId = 'pinned-browser-workspace'
    const worktreeId = 'wt-1'
    const state = {
      browserTabsByWorktree: { [worktreeId]: [{ id: workspaceId }] },
      browserPagesByWorkspace: { [workspaceId]: [page('pinned-page')] },
      activeBrowserTabIdByWorktree: { [worktreeId]: workspaceId },
      activeBrowserTabId: workspaceId,
      activeWorktreeId: worktreeId,
      unifiedTabsByWorktree: {},
      closeBrowserPage: vi.fn(),
      closeBrowserTab: vi.fn()
    }
    mocks.state.current = state
    mocks.guardPinnedTabClose.mockImplementation(({ onCancel }) => onCancel?.())
    const { close, replyTabClose } = registerCloseListener()

    await close({ requestId: 'pinned-cancel-request', tabId: workspaceId, worktreeId })

    expect(state.closeBrowserTab).not.toHaveBeenCalled()
    expect(mocks.flushRuntimeGraphSync).not.toHaveBeenCalled()
    expect(replyTabClose).toHaveBeenCalledWith({
      requestId: 'pinned-cancel-request',
      error: 'Browser tab {{value0}} is pinned'
    })
  })
})
