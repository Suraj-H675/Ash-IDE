type BrowserBackendProbe = () => boolean

let activeProbe: BrowserBackendProbe | null = null

/**
 * Register the backend currently managed by this local runtime process.
 * Registration is identity-scoped: stopping a replaced backend cannot erase
 * evidence owned by a newer one. A failed cleanup keeps its probe installed
 * until the process exits or another backend replaces it.
 */
export function registerHostedBrowserBackendProbe(probe: BrowserBackendProbe): () => void {
  activeProbe = probe
  return () => {
    if (activeProbe === probe) {
      activeProbe = null
    }
  }
}

/**
 * Positive-only: backend availability or unresolved helper cleanup is not
 * browser-tab, navigation, or operation inventory. A failed/false probe does
 * not establish that there are no browser helpers.
 */
export function observedHostedBrowserBackend(): 0 | 1 {
  try {
    return activeProbe?.() === true ? 1 : 0
  } catch {
    return 0
  }
}
