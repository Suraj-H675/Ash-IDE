import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionState } from '../../shared/workspace-session/workspace-session-state-types'
import type { BrowserBackendCreateTab } from '../browser/browser-backend'
import { ServeBrowserTabs } from './serve-browser-tabs'

const worktreeId = 'repo::/worktree'
const pageId = 'stable-page-id'
const savedSession = {
  activeRepoId: null,
  activeWorktreeId: worktreeId,
  activeTabId: null,
  tabsByWorktree: {},
  terminalLayoutsByTabId: {},
  activeBrowserTabIdByWorktree: { [worktreeId]: 'browser-tab-id' },
  browserTabsByWorktree: {
    [worktreeId]: [
      {
        id: 'browser-tab-id',
        worktreeId,
        sessionProfileId: 'alpha',
        activePageId: pageId,
        pageIds: [pageId],
        url: 'https://example.test/saved',
        title: 'Saved page',
        loading: false,
        faviconUrl: null,
        canGoBack: false,
        canGoForward: false,
        loadError: null,
        createdAt: 1
      }
    ]
  },
  browserPagesByWorkspace: {
    'browser-tab-id': [
      {
        id: pageId,
        workspaceId: 'browser-tab-id',
        worktreeId,
        url: 'https://example.test/saved',
        title: 'Saved page',
        loading: false,
        faviconUrl: null,
        canGoBack: false,
        canGoForward: false,
        loadError: null,
        createdAt: 1
      }
    ]
  }
} as WorkspaceSessionState

describe('ServeBrowserTabs', () => {
  it('restores a saved page once with its stable id, URL, and profile before reporting it live', async () => {
    const livePageIds = new Set<string>()
    const createTab = vi.fn(async (params: BrowserBackendCreateTab) => {
      if (params.browserPageId) {
        livePageIds.add(params.browserPageId)
      }
      return { browserPageId: params.browserPageId ?? 'created-page' }
    })
    const save = vi.fn()
    const tabs = new ServeBrowserTabs({
      backend: () => ({ createTab }) as never,
      installedBackend: () => ({ createTab }) as never,
      livePageIds: () => livePageIds,
      savedWorktreeIds: () => [worktreeId],
      session: () => savedSession,
      hostId: () => 'local',
      save
    })

    expect(tabs.hasSavedPage(worktreeId, pageId)).toBe(true)
    await expect(tabs.start(worktreeId, pageId)).resolves.toBe(true)
    await expect(tabs.start(worktreeId, pageId)).resolves.toBe(false)

    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith({
      browserPageId: pageId,
      url: 'https://example.test/saved',
      worktreeId,
      profileId: 'alpha',
      waitForInitialLoad: true
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('retires a saved offscreen page after the desktop returns without starting another guest', async () => {
    let session = savedSession
    const tabs = new ServeBrowserTabs({
      backend: () => null,
      installedBackend: () => ({}) as never,
      livePageIds: () => new Set(),
      savedWorktreeIds: () => [worktreeId],
      session: () => session,
      hostId: () => 'local',
      save: (_id, next) => {
        session = next
      }
    })
    expect(tabs.closed(worktreeId, pageId)).toBe(false)
    expect(tabs.hasSavedPage(worktreeId, pageId)).toBe(true)
    expect(tabs.closed(worktreeId, pageId, true)).toBe(true)
    expect(tabs.hasSavedPage(worktreeId, pageId)).toBe(false)
    await expect(tabs.start(worktreeId, pageId)).resolves.toBe(false)
  })

  it('keeps saved-page knowledge when the host has no usable browser backend', async () => {
    const tabs = new ServeBrowserTabs({
      backend: () => null,
      installedBackend: () => null,
      livePageIds: () => new Set(),
      savedWorktreeIds: () => [worktreeId],
      session: () => savedSession,
      hostId: () => 'local',
      save: vi.fn()
    })

    expect(tabs.hasSavedPage(undefined, pageId)).toBe(true)
    expect(tabs.hasStartable(undefined)).toBe(true)
    await expect(tabs.start(worktreeId, pageId)).resolves.toBe(false)
  })
})
