import { app } from 'electron'
import { notifyServeSupervisorReady } from '../updater/serve-update-handoff'
import { clearServeAbortPark } from '../../shared/serve-abort-park'
import { mainProcessState as state } from './main-process-state'
import { getServeOptions, type ServeOptions } from './serve-options'

export { getServeOptions, type ServeOptions }

export async function printServeReady(options: ServeOptions): Promise<void> {
  const runtime = state.runtime
  const runtimeRpc = state.runtimeRpc
  if (!runtime || !runtimeRpc) {
    throw new Error('Runtime server must be initialized before printing serve readiness')
  }
  await state.serveReadinessPublisher.publish(
    {
      runtimeId: runtime.getRuntimeId(),
      boundEndpoint: null,
      advertisedEndpoint: null,
      pairing: {
        available: false,
        reason: 'websocket_unavailable',
        guidance: 'Ash runtime control is available only through authenticated local IPC.'
      },
      // WSL barrier fails open; pending warns clients PTY launch may still race repair.
      managedWslCliReconciliation: state.managedWslCliReconciliationStatus
    },
    { mode: options.json ? 'json' : 'human' }
  )
  notifyServeSupervisorReady(runtime.getRuntimeId())
  // Successful readiness disproves the previous serve-abort park.
  clearServeAbortPark(app.getPath('userData'))
}
