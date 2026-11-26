import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'
import {
  unloadBrowserExtensionSession,
  type BrowserExtensionProfileUnloadState
} from './browser-extension-session-unload'

export type ProfileSessionState = BrowserExtensionProfileUnloadState & {
  profile: BrowserSessionProfile
}

type Cleanup = Parameters<typeof unloadBrowserExtensionSession>[1]
type CleanupStep = keyof Cleanup

/** A retiring session has no active load authority, but remains reachable for native cleanup. */
export class BrowserExtensionSessionRetirement {
  private readonly retiring = new Map<string, ProfileSessionState>()
  private readonly inFlight = new WeakMap<ProfileSessionState, Promise<void>>()
  private readonly completedCleanup = new WeakMap<ProfileSessionState, Set<CleanupStep>>()
  private globalInFlight: Promise<void> | undefined

  constructor(
    private readonly active: Map<string, ProfileSessionState>,
    private readonly cleanup: Cleanup
  ) {}

  get(profileId: string): ProfileSessionState | undefined {
    return this.retiring.get(profileId)
  }

  states(): ProfileSessionState[] {
    return [...new Set([...this.active.values(), ...this.retiring.values()])]
  }

  blocksAttachment(profile: BrowserSessionProfile): boolean {
    return (
      Boolean(this.globalInFlight) ||
      [...this.retiring.values()].some(
        (state) => state.profile.id === profile.id || state.profile.partition === profile.partition
      )
    )
  }

  private completeCleanup(state: ProfileSessionState, step: CleanupStep): void {
    const completed = this.completedCleanup.get(state) ?? new Set<CleanupStep>()
    this.completedCleanup.set(state, completed)
    if (!completed.has(step)) {
      this.cleanup[step](state.session)
      completed.add(step)
    }
  }

  private async unload(state: ProfileSessionState): Promise<void> {
    // Revoke Ash authority early while cancelled native loads settle. If this
    // step fails, the finalizer retries and reports a remaining failure.
    try {
      this.completeCleanup(state, 'forgetContexts')
    } catch {
      // The failed step remains pending; native removal must still proceed.
    }
    await unloadBrowserExtensionSession(state, {
      forgetContexts: () => this.completeCleanup(state, 'forgetContexts'),
      unregisterPreload: () => this.completeCleanup(state, 'unregisterPreload'),
      detached: () => this.completeCleanup(state, 'detached')
    })
  }

  retire(state: ProfileSessionState): Promise<void> {
    const profileId = state.profile.id
    const retiring = this.retiring.get(profileId)
    if (retiring && retiring !== state) {
      return Promise.reject(
        new Error('Another incarnation of this browser profile is still retiring')
      )
    }
    this.retiring.set(profileId, state)
    if (this.active.get(profileId) === state) {
      this.active.delete(profileId)
    }
    const existing = this.inFlight.get(state)
    if (existing) {
      return existing
    }
    const task = Promise.resolve()
      .then(() => this.unload(state))
      .then(() => {
        if (this.retiring.get(profileId) === state) {
          this.retiring.delete(profileId)
        }
      })
      .finally(() => this.inFlight.delete(state))
    this.inFlight.set(state, task)
    return task
  }

  retireAll(): Promise<void> {
    if (this.globalInFlight) {
      return this.globalInFlight
    }
    const states = this.states()
    const task = Promise.allSettled(states.map((state) => this.retire(state)))
      .then((results) => {
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : []
        )
        if (failures.length === 1) {
          throw failures[0]
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Could not fully retire browser extension sessions')
        }
      })
      .finally(() => {
        this.globalInFlight = undefined
      })
    this.globalInFlight = task
    return task
  }
}
