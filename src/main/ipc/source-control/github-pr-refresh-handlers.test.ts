import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGitHubPRRefreshHandlers } from './github-pr-refresh-handlers'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  enqueuePRRefresh: vi.fn(),
  reportVisiblePRRefreshCandidates: vi.fn(),
  refreshPRNow: vi.fn(),
  clearVisiblePRRefreshWindow: vi.fn(),
  setPRRefreshOutcomeObserver: vi.fn(),
  setPRRefreshRegistrationCheck: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))

vi.mock('../../github/pr-refresh-coordinator', () => ({
  enqueuePRRefresh: mocks.enqueuePRRefresh,
  reportVisiblePRRefreshCandidates: mocks.reportVisiblePRRefreshCandidates,
  refreshPRNow: mocks.refreshPRNow,
  clearVisiblePRRefreshWindow: mocks.clearVisiblePRRefreshWindow,
  setPRRefreshOutcomeObserver: mocks.setPRRefreshOutcomeObserver,
  setPRRefreshRegistrationCheck: mocks.setPRRefreshRegistrationCheck
}))

const repo = {
  id: 'registered-repo',
  path: '/workspace/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 0
}

function fakeEvent(senderId: number): { sender: EventEmitter & { id: number } } {
  return { sender: Object.assign(new EventEmitter(), { id: senderId }) }
}

describe('GitHub PR refresh IPC registration', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
  })

  it('registers only the four retained PR refresh channels and validates scheduled candidates', () => {
    const store = { getRepos: () => [repo] }
    const stats = { hasCountedPR: () => false, record: vi.fn() }
    registerGitHubPRRefreshHandlers(store as never, stats as never)

    expect([...mocks.handlers.keys()].sort()).toEqual([
      'gh:enqueuePRRefresh',
      'gh:prForBranch',
      'gh:refreshPRNow',
      'gh:reportVisiblePRRefreshCandidates'
    ])
    expect(mocks.handlers.has('gh:checkOrcaStarred')).toBe(false)
    expect(mocks.handlers.has('gh:starOrca')).toBe(false)

    const event = fakeEvent(37)
    const enqueue = mocks.handlers.get('gh:enqueuePRRefresh')!
    const unregisteredCandidate = {
      cacheKey: 'forged',
      repoId: 'forged-repo',
      repoPath: '/outside/repo',
      branch: 'main',
      repoKind: 'git'
    }
    const result = enqueue(event, { candidate: unregisteredCandidate, reason: 'visible' })
    expect(result).toEqual({ kind: 'skipped', skippedReason: 'validation-denied' })
    expect(mocks.enqueuePRRefresh).not.toHaveBeenCalled()

    const report = mocks.handlers.get('gh:reportVisiblePRRefreshCandidates')!
    expect(report(event, { candidates: [], generation: 4 })).toBe(true)
    expect(mocks.reportVisiblePRRefreshCandidates).toHaveBeenCalledWith([], 4, 37)
    expect(report(event, { candidates: [unregisteredCandidate], generation: 5 })).toBe(true)
    expect(mocks.reportVisiblePRRefreshCandidates).toHaveBeenLastCalledWith([], 5, 37)
    expect(event.sender.listenerCount('destroyed')).toBe(1)
    event.sender.emit('destroyed')
    expect(mocks.clearVisiblePRRefreshWindow).toHaveBeenCalledWith(37)
    expect(event.sender.listenerCount('destroyed')).toBe(0)
  })
})
