// Test-only disposable subprocess. The parent sends SIGKILL after the REAL
// guarded provider-file writer acknowledges a durable filesystem boundary.
// No globals, credentials, other applications, or real provider homes are used.
import { installStagedAshClaudeHookInFile } from '../ash-provider-hook-transaction.ts'
import { removeOwnedAshClaudeHookFromFile } from '../ash-provider-hook-removal.ts'

const { action, ashUserData, plan, id, expectedRaw, pauseAt } = JSON.parse(
  process.env.ASH_DISPOSABLE_CRASH_TEST ?? '{}'
)
const pauseAtBoundary = async (phase) => {
  if (phase !== pauseAt) {
    return
  }
  // A Node IPC listener holds the subprocess alive without polling or timers.
  process.on('message', () => {})
  process.send?.({ kind: 'guarded-writer-checkpoint', phase, pid: process.pid })
  // An intentionally unresolved test-only Promise holds the real transaction
  // at the selected point. Its parent MUST terminate only this child PID.
  await new Promise(() => {})
}

try {
  if (action === 'install') {
    await installStagedAshClaudeHookInFile({
      ashUserData,
      plan,
      expectedRaw,
      testBoundary: pauseAtBoundary
    })
  } else if (action === 'remove') {
    await removeOwnedAshClaudeHookFromFile({
      ashUserData,
      id,
      testBoundary: pauseAtBoundary
    })
  } else {
    throw new Error('unknown disposable guarded-writer action')
  }
  process.send?.({ kind: 'unexpected-writer-completion' })
} catch (error) {
  process.send?.({ kind: 'guarded-writer-error', message: String(error) })
  process.exitCode = 1
}
