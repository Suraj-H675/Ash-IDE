import {
  guardPinnedTabClose,
  isUnifiedTabPinned,
  resolvePinnedTabLabel
} from '../../store/pinned-tab-close-guard'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import {
  findBrowserTabWorktreeId,
  isBrowserWorkspaceOwnedByPairedServer,
  isDesktopRenderedBrowserTab
} from './browser-request-workspace-owner'
import { flushRuntimeGraphSync } from '@/runtime/sync-runtime-graph'

type BrowserCloseTarget =
  | { kind: 'workspace'; workspaceId: string; worktreeId?: string }
  | { kind: 'page'; browserPageId: string; workspaceId: string }

function browserCloseTargetIsPresent(
  state: ReturnType<typeof useAppStore.getState>,
  target: BrowserCloseTarget
): boolean {
  if (target.kind === 'page') {
    return (state.browserPagesByWorkspace[target.workspaceId] ?? []).some(
      (page) => page.id === target.browserPageId
    )
  }
  const tabs = target.worktreeId
    ? (state.browserTabsByWorktree[target.worktreeId] ?? [])
    : Object.values(state.browserTabsByWorktree).flat()
  return tabs.some((tab) => tab.id === target.workspaceId)
}

function waitForBrowserCloseTarget(target: BrowserCloseTarget): Promise<void> {
  const isPresent = (): boolean => browserCloseTargetIsPresent(useAppStore.getState(), target)
  if (!isPresent()) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = (): void => {}
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      unsubscribe()
      reject(new Error('Browser tab close timed out'))
    }, 10_000)
    const check = (): void => {
      if (!settled && !isPresent()) {
        settled = true
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    }
    unsubscribe = useAppStore.subscribe(check)
    check()
  })
}

async function completeBrowserClose(target: BrowserCloseTarget): Promise<void> {
  await waitForBrowserCloseTarget(target)
  await flushRuntimeGraphSync()
}

function replyBrowserTabNotFound(tabId: string, requestId: string): void {
  window.api.ui.replyTabClose({
    requestId,
    code: 'browser_tab_not_found',
    error: translate('auto.hooks.useIpcEvents.0e3cf53060', 'Browser tab {{value0}} not found', {
      value0: tabId
    })
  })
}

function replyPinnedBrowserCloseCanceled(tabId: string, requestId: string): void {
  window.api.ui.replyTabClose({
    requestId,
    error: translate('auto.hooks.useIpcEvents.2f6637fe6c', 'Browser tab {{value0}} is pinned', {
      value0: tabId
    })
  })
}

export function registerBrowserRequestTabClose(
  unsubs: (() => void)[],
  pairedServerWorkspaceError: () => string
): void {
  unsubs.push(
    window.api.ui.onRequestTabClose(async (data) => {
      try {
        const store = useAppStore.getState()
        const explicitTargetId = data.tabId ?? null
        const closeBrowserWorkspaceWithReply = async (
          worktreeId: string,
          workspaceId: string
        ): Promise<void> => {
          const currentStore = useAppStore.getState()
          await new Promise<void>((resolve, reject) => {
            guardPinnedTabClose({
              isPinned: isUnifiedTabPinned(currentStore, worktreeId, workspaceId),
              tabLabel: resolvePinnedTabLabel(currentStore, worktreeId, workspaceId),
              onClose: () => {
                useAppStore.getState().closeBrowserTab(workspaceId)
                void completeBrowserClose({ kind: 'workspace', worktreeId, workspaceId }).then(
                  () => {
                    window.api.ui.replyTabClose({ requestId: data.requestId })
                    resolve()
                  },
                  reject
                )
              },
              onCancel: () => {
                replyPinnedBrowserCloseCanceled(workspaceId, data.requestId)
                resolve()
              }
            })
          })
        }
        const tabToClose =
          explicitTargetId ??
          (data.worktreeId
            ? (store.activeBrowserTabIdByWorktree?.[data.worktreeId] ?? null)
            : store.activeBrowserTabId)
        if (!tabToClose) {
          window.api.ui.replyTabClose({
            requestId: data.requestId,
            error: translate('auto.hooks.useIpcEvents.a8d2bf8e9e', 'No active browser tab to close')
          })
          return
        }
        const closeWorktreeId = findBrowserTabWorktreeId(store, tabToClose)
        if (
          closeWorktreeId &&
          isBrowserWorkspaceOwnedByPairedServer(store, closeWorktreeId) &&
          !isDesktopRenderedBrowserTab(store, tabToClose)
        ) {
          window.api.ui.replyTabClose({
            requestId: data.requestId,
            error: pairedServerWorkspaceError()
          })
          return
        }
        // Resolve page IDs to workspace IDs for closeBrowserTab; page-close closes the workspace only for its last page.
        const isWorkspaceId = Object.values(store.browserTabsByWorktree)
          .flat()
          .some((workspace) => workspace.id === tabToClose)
        if (!isWorkspaceId) {
          const owningWorkspace = Object.entries(store.browserPagesByWorkspace).find(([, pages]) =>
            pages.some((page) => page.id === tabToClose)
          )
          if (owningWorkspace) {
            const [workspaceId, pages] = owningWorkspace
            const owningWorktreeId =
              Object.entries(store.browserTabsByWorktree).find(([, tabs]) =>
                tabs.some((tab) => tab.id === workspaceId)
              )?.[0] ?? null
            if (data.worktreeId && owningWorktreeId !== data.worktreeId) {
              replyBrowserTabNotFound(tabToClose, data.requestId)
              return
            }
            if (pages.length <= 1) {
              if (owningWorktreeId) {
                await closeBrowserWorkspaceWithReply(owningWorktreeId, workspaceId)
                return
              }
              store.closeBrowserTab(workspaceId)
              await completeBrowserClose({ kind: 'workspace', workspaceId })
            } else {
              store.closeBrowserPage(tabToClose)
              await completeBrowserClose({ kind: 'page', workspaceId, browserPageId: tabToClose })
            }
            window.api.ui.replyTabClose({ requestId: data.requestId })
            return
          }
        }
        const owningWorktreeId =
          Object.entries(store.browserTabsByWorktree).find(([, tabs]) =>
            tabs.some((tab) => tab.id === tabToClose)
          )?.[0] ?? null
        if (owningWorktreeId) {
          if (data.worktreeId && owningWorktreeId !== data.worktreeId) {
            replyBrowserTabNotFound(tabToClose, data.requestId)
            return
          }
          await closeBrowserWorkspaceWithReply(owningWorktreeId, tabToClose)
          return
        }
        if (explicitTargetId) {
          replyBrowserTabNotFound(explicitTargetId, data.requestId)
          return
        }
        store.closeBrowserTab(tabToClose)
        await completeBrowserClose({
          kind: 'workspace',
          worktreeId: data.worktreeId,
          workspaceId: tabToClose
        })
        window.api.ui.replyTabClose({ requestId: data.requestId })
      } catch (err) {
        window.api.ui.replyTabClose({
          requestId: data.requestId,
          error: err instanceof Error ? err.message : 'Tab close failed'
        })
      }
    })
  )
}
