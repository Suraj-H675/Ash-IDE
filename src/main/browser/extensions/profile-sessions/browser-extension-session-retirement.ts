import { BROWSER_EXTENSION_PROFILE_UNAVAILABLE } from './browser-extension-profile-loads'
import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'
import {
  unloadBrowserExtensionSession,
  type BrowserExtensionProfileUnloadState
} from './browser-extension-session-unload'

export type ProfileSessionState = BrowserExtensionProfileUnloadState & {
  profile: BrowserSessionProfile
  startupReadiness: Promise<void>
  retirement: AbortController
}

/** Retain strict readiness separately from the best-effort launch barrier. */
export function trackBrowserExtensionStartupReadiness(
  profileId: string,
  swept: Promise<unknown>,
  startupLoads: Promise<unknown>[]
): Pick<ProfileSessionState, 'loading' | 'startupReadiness'> {
  const startupReadiness = Promise.allSettled([swept, ...startupLoads]).then((results) => {
    const failures = [
      ...new Set(results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])))
    ]
    if (failures.length === 1) {
      throw failures[0]
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, `Could not restore extensions for profile ${profileId}`)
    }
  })
  void startupReadiness.catch(() => {})
  const loading = Promise.all([swept, ...startupLoads.map((load) => load.catch(() => {}))])
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn('[browser-extensions] Could not initialize extension storage:', error)
      throw error
    })
  void loading.catch(() => {})
  return { loading, startupReadiness }
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

  /** Wait only for the exact active profile incarnation. */
  whenRestored(profile: BrowserSessionProfile): Promise<void> {
    const profileId = profile.id
    const state = this.active.get(profileId)
    if (
      !state ||
      this.retiring.get(profileId) === state ||
      state.profile.partition !== profile.partition
    ) {
      return Promise.reject(new Error(BROWSER_EXTENSION_PROFILE_UNAVAILABLE))
    }
    return new Promise<void>((resolve, reject) => {
      const signal = state.retirement.signal
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) {
          return
        }
        settled = true
        signal.removeEventListener('abort', onRetiring)
        reject(error)
      }
      const finish = (): void => {
        if (settled) {
          return
        }
        if (
          this.active.get(profileId) !== state ||
          this.retiring.get(profileId) === state ||
          state.profile.partition !== profile.partition
        ) {
          fail(new Error(BROWSER_EXTENSION_PROFILE_UNAVAILABLE))
          return
        }
        settled = true
        signal.removeEventListener('abort', onRetiring)
        resolve()
      }
      const onRetiring = (): void => fail(new Error(BROWSER_EXTENSION_PROFILE_UNAVAILABLE))
      signal.addEventListener('abort', onRetiring, { once: true })
      if (signal.aborted) {
        onRetiring()
      } else {
        state.startupReadiness.then(finish, fail)
      }
    })
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
    state.retirement.abort()
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
