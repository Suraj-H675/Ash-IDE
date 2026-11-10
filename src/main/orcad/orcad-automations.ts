import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'

let stopScheduler: (() => void) | null = null

export function startOrcadAutomations(
  runtime: OrcaRuntimeService,
  store: Store,
  registerCleanup: (cleanup: () => void) => void
): void {
  const service = createRuntimeAutomationService({ store, runtime, headless: true })
  stopScheduler = () => service.stop()
  // Stop before final profile flush so runs cannot persist afterward.
  registerCleanup(() => service.stop())
  service.start()
}

export function stopOrcadAutomationScheduler(): void {
  stopScheduler?.()
}
