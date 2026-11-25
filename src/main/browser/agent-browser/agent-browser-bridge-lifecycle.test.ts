import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserBridgeLifecycle } from './agent-browser-bridge-lifecycle'

const pageId = 'stable-page-id'
const sessionName = `orca-tab-${pageId}`

function makeLifecycle(options: {
  currentWebContentsId: number | null
  session?: { webContentsId: number; activeInterceptPatterns: string[] }
  pendingWebContentsId?: number
  activeWebContentsId?: number | null
}): {
  lifecycle: AgentBrowserBridgeLifecycle
  sessions: Map<string, { webContentsId: number; activeInterceptPatterns: string[] }>
  destroySession: ReturnType<typeof vi.fn>
  onTabsChanged: ReturnType<typeof vi.fn>
} {
  const sessions = new Map<string, { webContentsId: number; activeInterceptPatterns: string[] }>()
  if (options.session) {
    sessions.set(sessionName, options.session)
  }
  const pendingSessionCreation = new Map<
    string,
    { webContentsId: number; promise: Promise<void> }
  >()
  if (options.pendingWebContentsId !== undefined) {
    pendingSessionCreation.set(sessionName, {
      webContentsId: options.pendingWebContentsId,
      promise: Promise.resolve()
    })
  }
  const onTabsChanged = vi.fn()
  const destroySession = vi.fn(
    async (_name: string, _options: unknown, expectedWebContentsId?: number) => {
      if (sessions.get(sessionName)?.webContentsId === expectedWebContentsId) {
        sessions.delete(sessionName)
      }
    }
  )
  // The lifecycle methods need only the state below; skip process/environment initialization.
  const lifecycle = Object.create(
    AgentBrowserBridgeLifecycle.prototype
  ) as AgentBrowserBridgeLifecycle
  Object.assign(lifecycle as unknown as Record<string, unknown>, {
    browserManager: {
      getGuestWebContentsId: () => options.currentWebContentsId,
      getWorktreeIdForTab: () => 'repo::/worktree'
    },
    sessions,
    pendingSessionCreation,
    pendingSessionDestruction: new Map(),
    pendingInterceptRestore: new Map(),
    activeWebContentsPerWorktree: new Map(),
    activeWebContentsId: options.activeWebContentsId ?? null,
    heldPersonSelections: new Map(),
    options: { onTabsChanged }
  })
  const destroySessionTarget = lifecycle as unknown as {
    destroySession: typeof destroySession
  }
  vi.spyOn(destroySessionTarget, 'destroySession').mockImplementation(destroySession)
  return { lifecycle, sessions, destroySession, onTabsChanged }
}

describe('AgentBrowserBridgeLifecycle owner retirement', () => {
  it('ignores a stale close after the page has a replacement WebContents owner', async () => {
    const newOwner = 202
    const { lifecycle, sessions, destroySession } = makeLifecycle({
      currentWebContentsId: newOwner,
      session: { webContentsId: newOwner, activeInterceptPatterns: ['https://example.test/*'] }
    })

    await lifecycle.onPageClosed(pageId, 101)

    expect(destroySession).not.toHaveBeenCalled()
    expect(sessions.get(sessionName)?.webContentsId).toBe(newOwner)
  })

  it('retires only the previous process owner and treats duplicate swap notices as no-ops', async () => {
    const oldOwner = 301
    const newOwner = 302
    const { lifecycle, sessions, destroySession, onTabsChanged } = makeLifecycle({
      currentWebContentsId: newOwner,
      session: { webContentsId: oldOwner, activeInterceptPatterns: ['https://example.test/*'] },
      activeWebContentsId: oldOwner
    })
    const privateLifecycle = lifecycle as unknown as {
      activeWebContentsId: number | null
      pendingInterceptRestore: Map<string, string[]>
    }

    await lifecycle.onProcessSwap(pageId, newOwner, oldOwner)
    await lifecycle.onProcessSwap(pageId, newOwner, oldOwner)

    expect(destroySession).toHaveBeenCalledTimes(1)
    expect(destroySession).toHaveBeenCalledWith(sessionName, { keepQueuedCommands: true }, oldOwner)
    expect(sessions.has(sessionName)).toBe(false)
    expect(privateLifecycle.activeWebContentsId).toBe(newOwner)
    expect(privateLifecycle.pendingInterceptRestore.get(sessionName)).toEqual([
      'https://example.test/*'
    ])
    expect(onTabsChanged).toHaveBeenCalledTimes(1)
  })

  it('waits for a session creation only when it belongs to the retired owner', async () => {
    const { lifecycle, destroySession } = makeLifecycle({
      currentWebContentsId: 402,
      pendingWebContentsId: 401
    })

    await lifecycle.onProcessSwap(pageId, 402, 401)

    expect(destroySession).toHaveBeenCalledWith(sessionName, { keepQueuedCommands: true }, 401)
  })
})
