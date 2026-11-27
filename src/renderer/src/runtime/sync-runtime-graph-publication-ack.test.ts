import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeState } from './sync-runtime-graph-test-harness'

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  schedule: vi.fn(),
  snapshot: { worktree: 'close-fixture-worktree', tabs: [], snapshotVersion: 2 }
}))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({ getEagerPtyBufferHandle: vi.fn() }))
vi.mock('@/components/terminal-pane/terminal-parked-watcher-registry', () => ({
  collectParkedTerminalWatcherPtyIds: () => new Set(),
  getParkedTerminalWatcherPaneIdsByPtyId: vi.fn()
}))
vi.mock('@/lib/terminal-theme', () => ({ getSystemPrefersDark: () => false }))
vi.mock('./sync-runtime-graph/mobile-session-snapshots', () => ({
  buildMobileSessionTabSnapshots: () => [mocks.snapshot]
}))
vi.mock('./sync-runtime-graph/project-section-catalog', () => ({
  getProjectSectionCatalogFromState: () => null
}))
vi.mock('./sync-runtime-graph/terminal-group-grid-sizes', () => ({
  measureTerminalGroupGridSizes: () => null
}))
vi.mock('./mounted-terminal-tab-registry', () => ({
  mountedTerminalTabEntries: () => [],
  findRegisteredTerminalTab: () => null,
  getMountedTerminalTabRegisteredAt: vi.fn()
}))
import { graphState } from './sync-runtime-graph/graph-state'
import {
  syncRuntimeGraph,
  setTrailingGraphSyncScheduler
} from './sync-runtime-graph/graph-publication'

describe('graph publication acknowledgment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    graphState.syncEnabled = true
    graphState.getStoreState = () => makeState()
    graphState.publishedMobileSessionSnapshotByWorktree.clear()
    vi.stubGlobal('window', { api: { runtime: { syncWindowGraph: mocks.publish } } })
    setTrailingGraphSyncScheduler(mocks.schedule)
  })
  afterEach(() => {
    graphState.syncEnabled = false
    graphState.getStoreState = null
    graphState.publishedMobileSessionSnapshotByWorktree.clear()
    vi.unstubAllGlobals()
  })
  it('does not acknowledge a snapshot that main requires to be resynchronized', async () => {
    mocks.publish.mockResolvedValueOnce({ mobileSessionResyncWorktrees: [mocks.snapshot.worktree] })
    expect(await syncRuntimeGraph()).toBe(false)
    expect(mocks.schedule).toHaveBeenCalledOnce()
    expect(graphState.publishedMobileSessionSnapshotByWorktree.has(mocks.snapshot.worktree)).toBe(
      false
    )
    mocks.publish.mockResolvedValueOnce({})
    expect(await syncRuntimeGraph()).toBe(true)
    expect(mocks.publish.mock.calls[1][0].mobileSessionTabs).toEqual([mocks.snapshot])
  })
})
