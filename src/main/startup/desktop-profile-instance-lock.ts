/** Share orcad's profile lock to prevent concurrent desktop/serve writers; Electron's own instance lock cannot fence plain Node. */
import { acquireOrcadInstanceLock, type OrcadInstanceLock } from '../orcad/orcad-instance-lock'
import { OrcadInstanceLockError } from '../orcad/orcad-data-root-privacy'
import { acquireProfileStateRuntimeHost } from '../persistence/profile-state/profile-state-access'
import { writeStartupDiagnosticLine, type StartupDiagnosticSink } from './startup-diagnostics'

export type DesktopProfileLockResult =
  | { state: 'acquired'; lock: OrcadInstanceLock }
  | { state: 'held'; message: string }
  /** An unverifiable lock is never evidence that this process can safely write. */
  | { state: 'refused'; message: string }

export function acquireDesktopProfileInstanceLock(
  userDataPath: string,
  acquire: typeof acquireOrcadInstanceLock = acquireOrcadInstanceLock,
  write?: StartupDiagnosticSink,
  notifyOwnershipLost?: () => void
): DesktopProfileLockResult {
  let sharedLock: OrcadInstanceLock | undefined
  let lostSharedOwnership = false
  try {
    sharedLock = acquire(userDataPath, {
      role: 'desktop',
      onExclusivityLost: () => {
        lostSharedOwnership = true
        // The successor may already be writing: do not flush or admit more work.
        writeStartupDiagnosticLine(
          '[single-instance] Lost exclusive desktop profile ownership',
          write
        )
        try {
          // A native notification is best-effort: it cannot delay a fatal exit.
          notifyOwnershipLost?.()
        } catch {
          // Never let a notification failure keep a displaced writer running.
        }
        process.exit(1)
      }
    })
    // On Linux a second durable owner closes the gap if orcad.lock is removed
    // while a desktop or serve process is still alive. Do not publish this
    // additional owner on macOS/Windows until cloned-host recovery can be
    // proven safe there; those platforms retain their existing shared lock.
    const runtimeHost =
      process.platform === 'linux' ? acquireProfileStateRuntimeHost(userDataPath) : undefined
    const lock: OrcadInstanceLock = {
      ...sharedLock,
      release(): void {
        try {
          // Emergency exit retains the independent owner until this PID is
          // provably dead, including while native persistence workers wind down.
          if (!lostSharedOwnership) {
            runtimeHost?.release()
          }
        } finally {
          sharedLock?.release()
        }
      }
    }
    // Best effort: a lock left by a dead pid is reclaimed on the next start anyway.
    process.once('exit', () => lock.release())
    return { state: 'acquired', lock }
  } catch (error) {
    sharedLock?.release()
    // A holder this machine cannot judge may still be running: refusing keeps one writer.
    if (
      error instanceof OrcadInstanceLockError &&
      (error.code === 'orcad_instance_lock_held' ||
        error.code === 'orcad_instance_lock_holder_unverifiable')
    ) {
      writeStartupDiagnosticLine(`[single-instance] ${error.message}`, write)
      return { state: 'held', message: error.message }
    }
    const detail = error instanceof Error ? error.message : String(error)
    const message =
      `Ash IDE could not establish exclusive access to this profile. ` +
      `Startup was stopped to protect local state. ${detail}`
    writeStartupDiagnosticLine(`[single-instance] ${message}`, write)
    return { state: 'refused', message }
  }
}
