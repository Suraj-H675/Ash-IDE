type BrowserBackendProbe = () => boolean

type ProbeRegistration = {
  probe: BrowserBackendProbe
  observedPositive: boolean
  retainedPositive: boolean
  retired: boolean
}

let activeRegistration: ProbeRegistration | null = null
let retainedPositiveRegistrations = 0

function readPositive(registration: ProbeRegistration): boolean {
  try {
    const positive = registration.probe() === true
    registration.observedPositive ||= positive
    return positive
  } catch {
    return false
  }
}

/**
 * Register the backend currently managed by this local runtime process.
 * Registration is identity-scoped: stopping a replaced backend cannot erase
 * evidence owned by a newer one. Replacement retains a prior positive signal
 * until that exact registration confirms cleanup and retires.
 */
export function registerHostedBrowserBackendProbe(probe: BrowserBackendProbe): () => void {
  if (activeRegistration) {
    const previousWasPositive = readPositive(activeRegistration)
    if (previousWasPositive || activeRegistration.observedPositive) {
      activeRegistration.retainedPositive = true
      retainedPositiveRegistrations += 1
    }
  }

  const registration: ProbeRegistration = {
    probe,
    observedPositive: false,
    retainedPositive: false,
    retired: false
  }
  activeRegistration = registration

  return () => {
    if (registration.retired) {
      return
    }
    registration.retired = true
    if (registration.retainedPositive) {
      retainedPositiveRegistrations = Math.max(0, retainedPositiveRegistrations - 1)
    }
    if (activeRegistration === registration) {
      activeRegistration = null
    }
  }
}

/**
 * Positive-only: backend availability or unresolved helper cleanup is not
 * browser-tab, navigation, or operation inventory. A failed/false probe does
 * not establish that there are no browser helpers.
 */
export function observedHostedBrowserBackend(): 0 | 1 {
  const activeIsPositive = activeRegistration ? readPositive(activeRegistration) : false
  return activeIsPositive || retainedPositiveRegistrations > 0 ? 1 : 0
}
