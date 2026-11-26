import type {
  BrowserExtensionSupportRuntime,
  BrowserExtensionSupportStatus
} from '../../../shared/browser/extensions/browser-extension-types'

const listeners = new Set<(status: BrowserExtensionSupportStatus) => void>()
const activeMutations = new Map<AbortController, Promise<void>>()

let status: BrowserExtensionSupportStatus = { desiredEnabled: false, runtime: 'disabled' }
let mutationAdmissionOpen = false
let mutationPauses = 0

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
  mutationAdmissionOpen = status.runtime === 'enabled' && mutationPauses === 0
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

export function isBrowserExtensionMutationPaused(): boolean {
  return mutationPauses > 0
}

export function withBrowserExtensionMutation<T>(
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (!mutationAdmissionOpen) {
    return Promise.reject(new Error('Browser extension support is changing or unavailable'))
  }

  const controller = new AbortController()
  let finish!: () => void
  const settled = new Promise<void>((resolve) => {
    finish = resolve
  })
  activeMutations.set(controller, settled)
  return Promise.resolve()
    .then(() => operation(controller.signal))
    .finally(() => {
      activeMutations.delete(controller)
      finish()
    })
}

/** Closes new mutation admission before waiting for already admitted work to finish. */
export async function drainBrowserExtensionMutations(): Promise<void> {
  await Promise.all(activeMutations.values())
}

/** Profile retirement pauses extension mutations without changing the global support status. */
export async function pauseBrowserExtensionMutations(): Promise<() => void> {
  mutationPauses += 1
  refreshMutationAdmission()
  abortActiveMutations()
  await drainBrowserExtensionMutations()
  let resumed = false
  return () => {
    if (resumed) {
      return
    }
    resumed = true
    mutationPauses = Math.max(0, mutationPauses - 1)
    refreshMutationAdmission()
  }
}
