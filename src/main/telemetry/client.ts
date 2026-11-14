// Ash IDE excludes product analytics (EX-09). Preserve this inert compatibility
// surface while older diagnostic call sites are migrated to local observability.
// No SDK, network transport, install identity, consent mutation, or timer exists here.

import type { EventName, EventProps, OptInVia } from '../../shared/telemetry-events'
import type { Store } from '../persistence/loading-store/store'

// Release/packaging validation expects this literal; it must remain false in Ash.
const TELEMETRY_ENABLED = false

/** Old startup call sites cannot initialize analytics for any profile or build identity. */
export function initTelemetry(_store: Store, _scheduleStart: (start: () => void) => void): void {
  // Deliberately empty. Do not touch persisted opt-in or historic install identity.
}

/** Protects usage scans from preparing analytics-only payloads. */
export function isTelemetryEnabled(): boolean {
  return TELEMETRY_ENABLED
}

export function track<N extends EventName>(_name: N, _props: EventProps<N>): boolean {
  return false
}

export function hasTrackedAgentDashboardActiveToday(_props: unknown): boolean {
  return false
}

/** Old consent entry points cannot silently rewrite historic user settings. */
export async function setOptIn(_via: OptInVia, _optedIn: boolean): Promise<void> {}

export async function persistBannerAcknowledgeWithoutEmitting(): Promise<void> {}

export function trackAppOpenedOnce(): void {}

/** Local diagnostic flushes are independent of this removed product transport. */
export async function shutdownTelemetry(): Promise<void> {}
