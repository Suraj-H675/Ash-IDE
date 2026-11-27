import type {
  BrowserExtensionSupportRuntime,
  BrowserExtensionSupportStatus
} from '../../../shared/browser/extensions/browser-extension-types'

const listeners = new Set<(status: BrowserExtensionSupportStatus) => void>()
const activeMutations = new Map<AbortController, { profileId?: string; settled: Promise<void> }>()
const pausedProfiles = new Map<string, number>()

let status: BrowserExtensionSupportStatus = { desiredEnabled: false, runtime: 'disabled' }
let mutationAdmissionOpen = false

function publish(): void {
  const snapshot = getBrowserExtensionSupportStatus()
  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch {
      // Status observers cannot interrupt the runtime transition.
    }
  }
}

function abortActiveMutations(): void {
  for (const controller of activeMutations.keys()) {
    controller.abort()
  }
}

function refreshMutationAdmission(): void {
  mutationAdmissionOpen = status.runtime === 'enabled'
}

export function getBrowserExtensionSupportStatus(): BrowserExtensionSupportStatus {
  return { ...status }
}

export function onBrowserExtensionSupportStatusChanged(
  listener: (status: BrowserExtensionSupportStatus) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBrowserExtensionSupportDesired(enabled: boolean): void {
  if (status.desiredEnabled === enabled) {
    return
  }
  status = { ...status, desiredEnabled: enabled }
  publish()
}

export function setBrowserExtensionSupportRuntime(runtime: BrowserExtensionSupportRuntime): void {
  if (status.runtime === runtime) {
    refreshMutationAdmission()
    return
  }
  status = { ...status, runtime }
  refreshMutationAdmission()
  if (!mutationAdmissionOpen) {
    abortActiveMutations()
  }
  publish()
}

/** Startup applies the saved preference before any browser profile session is created. */
export function setBrowserExtensionSupportEnabled(enabled: boolean): void {
  status = { desiredEnabled: enabled, runtime: enabled ? 'enabled' : 'disabled' }
  refreshMutationAdmission()
  if (!mutationAdmissionOpen) {
    abortActiveMutations()
  }
  publish()
}

export function isBrowserExtensionSupportEnabled(): boolean {
  return status.runtime === 'enabled' || status.runtime === 'enabling'
}

export function isBrowserExtensionMutationPaused(profileId?: string): boolean {
  // Unscoped changes affect shared installation state and may touch every profile.
  return profileId === undefined ? pausedProfiles.size > 0 : pausedProfiles.has(profileId)
}

export function withBrowserExtensionMutation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  profileId?: string
): Promise<T> {
  if (!mutationAdmissionOpen || isBrowserExtensionMutationPaused(profileId)) {
    return Promise.reject(new Error('Browser extension support is changing or unavailable'))
  }

  const controller = new AbortController()
  let finish!: () => void
  const settled = new Promise<void>((resolve) => {
    finish = resolve
  })
  activeMutations.set(controller, { profileId, settled })
  return Promise.resolve()
    .then(() => operation(controller.signal))
    .finally(() => {
      activeMutations.delete(controller)
      finish()
    })
}

/** Closes new mutation admission before waiting for already admitted work to finish. */
export async function drainBrowserExtensionMutations(): Promise<void> {
  await Promise.all([...activeMutations.values()].map((mutation) => mutation.settled))
}

/** Fence the retiring profile and shared operations, not unrelated profile lifetimes. */
export async function pauseBrowserExtensionMutations(profileId: string): Promise<() => void> {
  pausedProfiles.set(profileId, (pausedProfiles.get(profileId) ?? 0) + 1)
  const draining: Promise<void>[] = []
  for (const [controller, mutation] of activeMutations) {
    if (mutation.profileId === undefined || mutation.profileId === profileId) {
      controller.abort()
      draining.push(mutation.settled)
    }
  }
  await Promise.all(draining)
  let resumed = false
  return () => {
    if (resumed) {
      return
    }
    resumed = true
    const count = pausedProfiles.get(profileId) ?? 0
    if (count <= 1) {
      pausedProfiles.delete(profileId)
    } else {
      pausedProfiles.set(profileId, count - 1)
    }
  }
}
