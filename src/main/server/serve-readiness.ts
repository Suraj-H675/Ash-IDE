import type { OrcadHealth } from '../orcad/orcad-health'
import type { PairingOfferUnavailable } from '../runtime/rpc/server/runtime-rpc-pairing-types'
import { describePtyProcessCeiling } from '../../shared/terminal/pty/native-process/pty-process-ceiling-state'

type ServePairingStatus =
  | (Omit<PairingOfferUnavailable, 'reason'> & {
      reason: PairingOfferUnavailable['reason'] | 'disabled_by_operator'
    })
  | {
      available: true
      url: string
      endpoint: string
      deviceId: string
      webClientUrl: string | null
      scope: 'runtime' | 'mobile'
      qr: string | null
    }

export type ServeReadiness = {
  runtimeId: string
  boundEndpoint: string | null
  advertisedEndpoint: string | null
  pairing: ServePairingStatus
  managedWslCliReconciliation: 'pending' | 'settled' | 'failed'
  /** Optional for older/Electron hosts: absence means unreported, never healthy. Carries build identity, Node ABI and terminal-daemon self-test. */
  health?: OrcadHealth
}

export type ServeReadinessOutput =
  | { mode: 'human' | 'json' }
  | { mode: 'recipe-json'; projectRoot: string }

type ReadinessWrite = (output: string) => Promise<void>

export class ServeReadinessPublisher {
  private state: 'pending' | 'publishing' | 'published' | 'failed' = 'pending'

  constructor(private readonly write: ReadinessWrite = writeStdout) {}

  async publish(readiness: ServeReadiness, output: ServeReadinessOutput): Promise<void> {
    if (this.state !== 'pending') {
      throw new Error(`Serve readiness publication already ${this.state}`)
    }
    this.state = 'publishing'
    try {
      await this.write(`${renderServeReadiness(readiness, output)}\n`)
      this.state = 'published'
    } catch (error) {
      this.state = 'failed'
      throw error
    }
  }
}

export function renderServeReadiness(
  readiness: ServeReadiness,
  output: ServeReadinessOutput
): string {
  if (output.mode !== 'human') {
    return JSON.stringify({
      type: 'ash_runtime_ready',
      schemaVersion: 1,
      runtimeId: readiness.runtimeId,
      managedWslCliReconciliation: readiness.managedWslCliReconciliation,
      ...(readiness.health ? { health: readiness.health } : {})
    })
  }
  return renderHumanReadiness(readiness)
}

function renderHumanReadiness(readiness: ServeReadiness): string {
  const lines = ['Ash local runtime ready', `Runtime ID: ${readiness.runtimeId}`]
  if (readiness.health) {
    const daemon = readiness.health.terminalDaemon
    lines.push(
      `Build: ${readiness.health.buildVersion} (${readiness.health.buildHash}), Node ` +
        `${readiness.health.nodeVersion} ABI ${readiness.health.nodeAbi}`
    )
    lines.push(
      `Terminal daemon: ${daemon.state} — PTY self-test ${daemon.selfTest.ok ? 'passed' : 'FAILED'}` +
        ` (${daemon.selfTest.coverage}: ${daemon.selfTest.verdict})` +
        `; terminals survive an orcad restart: ${daemon.ownsFreshSessions ? 'yes' : 'NO'}`
    )
    if (daemon.processCeiling !== undefined) {
      lines.push(`Terminal process ceiling: ${describePtyProcessCeiling(daemon.processCeiling)}`)
    }
  }
  return lines.join('\n')
}

function writeStdout(output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
