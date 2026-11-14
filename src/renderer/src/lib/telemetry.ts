// Typed compatibility wrapper for legacy event call sites. Ash's preload bridge
// always rejects product telemetry and never dispatches these calls to main.

import type { EventName, EventProps } from '../../../shared/telemetry-events'

// Re-exported so renderer call sites can import the mapper alongside `track` (impl is shared because main needs the same mapping).
export { tuiAgentToAgentKind } from '../../../shared/agent-kind'

export function track<N extends EventName>(name: N, props: EventProps<N>): void {
  void trackWithResult(name, props)
}

// Undefined supports older bridges; false lets visible-use observations retry a rejected attempt.
export function trackWithResult<N extends EventName>(
  name: N,
  props: EventProps<N>
): Promise<boolean | void> {
  // Telemetry must never throw into renderer callers; log IPC failure for breadcrumbs instead of rethrowing or silently swallowing.
  try {
    return (
      window.api?.telemetryTrack?.(name, { ...props })?.catch((err) => {
        console.warn('[telemetry] IPC track failed', err)
        return false
      }) ?? Promise.resolve(false)
    )
  } catch (err) {
    console.warn('[telemetry] IPC track threw synchronously', err)
    return Promise.resolve(false)
  }
}
