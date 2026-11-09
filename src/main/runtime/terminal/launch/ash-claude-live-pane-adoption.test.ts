import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  setupLayoutOwnerRuntime,
  WORKTREE_ID
} from '../../orca-runtime-tests/orca-runtime-layout-owner-start-fixture'
import { committingSpawn } from '../../orca-runtime-tests/bind-first-pane.test-fixture'

vi.mock('../../../../shared/layout-owner-switch', () => ({ ORCA_LAYOUT_OWNER_IS_MAIN: true }))

/**
 * A live daemon-backed pane is an existing process, not a new Claude launch.
 * Its identity must win over a caller's saved resume command and settings.
 */
function liveClaudePane() {
  const fixture = setupLayoutOwnerRuntime()
  const pane = { tabId: randomUUID(), leafId: randomUUID() }
  const capturedSessionId = randomUUID()
  const firstCommand = `claude --resume ${capturedSessionId}`
  return { ...fixture, pane, capturedSessionId, firstCommand }
}

describe('Ash Claude reattaches a live PTY without relaunching', () => {
  it('adopts an existing pane without dispatching a saved Claude resume command', async () => {
    const h = liveClaudePane()
    const initial = await h.runtime.createTerminal(`id:${WORKTREE_ID}`, {
      ...h.pane,
      command: 'claude',
      presentation: 'background'
    })
    expect(h.spawn).toHaveBeenCalledTimes(1)
    const originalLaunch = h.spawn.mock.calls[0]?.[0]
    expect(initial.ptyId).toBeTruthy()

    const attached = vi.fn(async () => ({
      owner: {
        tabId: h.pane.tabId,
        leafId: h.pane.leafId,
        ptyId: initial.ptyId!,
        handle: initial.handle
      },
      result: { id: initial.ptyId!, launchAgent: 'claude' as const, isReattach: true as const },
      materialized: true as const
    }))
    h.runtime.setPtyController({
      spawn: committingSpawn(h.runtime, h.spawn),
      adoptStablePane: attached,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    const dispatched = vi.fn()
    const reopened = await h.runtime.createTerminal(`id:${WORKTREE_ID}`, {
      ...h.pane,
      command: h.firstCommand,
      resumeProviderSession: { key: 'session_id', id: h.capturedSessionId },
      reopensPane: true,
      presentation: 'background',
      onPtySpawnDispatched: dispatched
    })

    expect(attached).toHaveBeenCalledTimes(1)
    expect(attached).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: h.pane.tabId, leafId: h.pane.leafId })
    )
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.spawn.mock.calls[0]?.[0]).toBe(originalLaunch)
    expect(dispatched).not.toHaveBeenCalled()
    expect(reopened.isReattach).toBe(true)
    expect(reopened.ptyId).toBe(initial.ptyId)
    expect(reopened.handle).toBe(initial.handle)
    expect(reopened.tabId).toBe(h.pane.tabId)
    expect(reopened.paneKey).toBe(initial.paneKey)
  })

  it('refuses an explicit fresh-agent launch into a live pane instead of duplicating it', async () => {
    const h = liveClaudePane()
    const initial = await h.runtime.createTerminal(`id:${WORKTREE_ID}`, {
      ...h.pane,
      command: 'claude',
      presentation: 'background'
    })
    expect(h.spawn).toHaveBeenCalledTimes(1)

    h.runtime.setPtyController({
      spawn: committingSpawn(h.runtime, h.spawn),
      adoptStablePane: vi.fn(async () => ({
        owner: {
          tabId: h.pane.tabId,
          leafId: h.pane.leafId,
          ptyId: initial.ptyId!,
          handle: initial.handle
        },
        result: { id: initial.ptyId!, isReattach: true as const },
        materialized: true as const
      })),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    const dispatched = vi.fn()
    await expect(
      h.runtime.createTerminal(`id:${WORKTREE_ID}`, {
        ...h.pane,
        command: h.firstCommand,
        requireFreshPane: true,
        presentation: 'background',
        onPtySpawnDispatched: dispatched
      })
    ).rejects.toThrow()
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(dispatched).not.toHaveBeenCalled()
  })
})
