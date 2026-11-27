import type { AppState } from '@/store/types'
import {
  syncRuntimeGraph,
  setTrailingGraphSyncScheduler
} from './sync-runtime-graph/graph-publication'
import { graphState, RUNTIME_GRAPH_SYNC_COALESCE_MS } from './sync-runtime-graph/graph-state'
import { subscribeMountedTerminalTabChanges } from './mounted-terminal-tab-registry'
import { measureTerminalGroupGridSizes } from './sync-runtime-graph/terminal-group-grid-sizes'

let runtimeGraphSyncPromise: Promise<boolean> | null = null

export function setRuntimeGraphStoreStateGetter(getter: (() => AppState) | null): void {
  graphState.getStoreState = getter
}

export function setRuntimeGraphSyncEnabled(enabled: boolean): void {
  graphState.syncEnabled = enabled
  if (!enabled) {
    graphState.syncPendingAfterFlight = false
    clearScheduledRuntimeGraphSync()
    return
  }
  scheduleRuntimeGraphSync()
}

function clearScheduledRuntimeGraphSync(): void {
  if (graphState.syncTimer !== null) {
    clearTimeout(graphState.syncTimer)
    graphState.syncTimer = null
  }
  graphState.syncScheduled = false
}

export function scheduleRuntimeGraphSync(): void {
  if (!graphState.syncEnabled || graphState.syncScheduled) {
    return
  }
  if (graphState.syncInFlight) {
    graphState.syncPendingAfterFlight = true
    return
  }
  graphState.syncScheduled = true
  // Collapse separate title/status tasks into one frame-sized graph publication.
  graphState.syncTimer = setTimeout(() => {
    graphState.syncTimer = null
    graphState.syncScheduled = false
    void runRuntimeGraphSync()
  }, RUNTIME_GRAPH_SYNC_COALESCE_MS)
}

/** Complete a browser close only after main has accepted the renderer's latest tab graph. */
export async function flushRuntimeGraphSync(): Promise<void> {
  if (!graphState.syncEnabled || !graphState.getStoreState) {
    throw new Error('Browser tab close could not be synchronized')
  }
  clearScheduledRuntimeGraphSync()
  if (runtimeGraphSyncPromise) {
    await runtimeGraphSyncPromise
  }
  clearScheduledRuntimeGraphSync()
  graphState.syncPendingAfterFlight = false
  if (!(await runRuntimeGraphSync())) {
    throw new Error('Browser tab close could not be synchronized')
  }
}

/** Republishes the graph only when the grid a new tab would get in some group changed. */
export function scheduleRuntimeGraphSyncIfGroupGridSizesChanged(): void {
  const state = graphState.getStoreState?.()
  if (!state) {
    return
  }
  const sizes = measureTerminalGroupGridSizes(state.settings?.terminalFontSize ?? 14)
  if (JSON.stringify(sizes ?? null) !== graphState.publishedTerminalGroupGridSizesKey) {
    scheduleRuntimeGraphSync()
  }
}

/** A tab group body resized (window, divider, sidebar): its group's grid may have changed. */
export function observeTabGroupBodyGridSize(body: HTMLElement): () => void {
  const observer = new ResizeObserver(scheduleRuntimeGraphSyncIfGroupGridSizesChanged)
  observer.observe(body)
  return () => observer.disconnect()
}

function runRuntimeGraphSync(): Promise<boolean> {
  if (graphState.syncInFlight) {
    graphState.syncPendingAfterFlight = true
    return runtimeGraphSyncPromise ?? Promise.resolve(false)
  }
  graphState.syncInFlight = true
  let tracked: Promise<boolean>
  tracked = syncRuntimeGraph().finally(() => {
    graphState.syncInFlight = false
    if (runtimeGraphSyncPromise === tracked) {
      runtimeGraphSyncPromise = null
    }
    if (graphState.syncPendingAfterFlight) {
      graphState.syncPendingAfterFlight = false
      scheduleRuntimeGraphSync()
    }
  })
  runtimeGraphSyncPromise = tracked
  return tracked
}

setTrailingGraphSyncScheduler(scheduleRuntimeGraphSync)
subscribeMountedTerminalTabChanges(scheduleRuntimeGraphSync)
