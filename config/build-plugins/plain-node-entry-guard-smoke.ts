import { spawn } from 'node:child_process'
import { join } from 'node:path'

const DAEMON_USAGE_PREFIX = 'Usage: daemon-entry'

export type SmokeTimings = {
  timeoutMs: number
  // daemon-entry traps SIGTERM and awaits a native shutdown, so the deadline
  // needs an uncatchable follow-up to stay a deadline.
  killGraceMs: number
}

export const DEFAULT_SMOKE_TIMINGS: SmokeTimings = { timeoutMs: 15_000, killGraceMs: 2_000 }

// Bound the wait for stderr to flush after exit; a grandchild inheriting stdio
// can hold the pipes open long after the child is gone.
const SMOKE_STDERR_DRAIN_MS = 250

type SmokeResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stderr: string
  error?: Error
  timedOut: boolean
}

// spawnSync timeout waits after SIGTERM; trapped signals can hang builds, so escalate asynchronously to SIGKILL.
function runDaemonEntry(
  entryPath: string,
  timings: SmokeTimings,
  inheritStderr: boolean
): Promise<SmokeResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entryPath], {
      stdio: ['ignore', 'ignore', inheritStderr ? 'inherit' : 'pipe']
    })
    let stderr = ''
    let timedOut = false
    let settled = false
    let forceKillTimer: NodeJS.Timeout | undefined
    let drainTimer: NodeJS.Timeout | undefined

    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
    }

    const deadlineTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), timings.killGraceMs)
    }, timings.timeoutMs)

    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(deadlineTimer)
      clearTimeout(forceKillTimer)
      clearTimeout(drainTimer)
      resolve({ status, signal, stderr, error, timedOut })
    }

    child.on('error', (error: Error) => finish(null, null, error))
    // 'close' gives the full stderr; 'exit' is the fallback so a held-open pipe
    // cannot outlast the process itself.
    child.on('close', (status, signal) => finish(status, signal))
    child.on('exit', (status, signal) => {
      drainTimer = setTimeout(() => finish(status, signal), SMOKE_STDERR_DRAIN_MS)
    })
  })
}

// Smoke proves plain-Node graph resolution; static scan catches Electron leaks because dev node_modules can make require("electron") succeed.
export async function smokeLoadDaemonEntry(
  outputDir: string,
  timings: SmokeTimings
): Promise<void> {
  const entryPath = join(outputDir, 'daemon-entry.js')
  const inheritStderr = process.env.ASH_ALLOW_UNCOMMITTED_BUILD === '1'
  const result = await runDaemonEntry(entryPath, timings, inheritStderr)
  if (result.error) {
    throw new Error(
      `[plain-node-entry-guard] could not smoke-load daemon-entry.js under plain Node: ` +
        `${result.error.message}`
    )
  }
  // Almost always means the daemon stopped rejecting an empty argv and started
  // listening instead.
  if (result.timedOut) {
    throw new Error(
      `[plain-node-entry-guard] daemon-entry.js did not exit within ${timings.timeoutMs}ms on an ` +
        `empty argv under plain Node, so the smoke killed it.`
    )
  }
  const { signal, stderr } = result
  if (signal) {
    throw new Error(
      `[plain-node-entry-guard] daemon-entry.js was killed by ${signal} under plain Node.`
    )
  }
  if (/Cannot find module|MODULE_NOT_FOUND/.test(stderr)) {
    throw new Error(`[plain-node-entry-guard] daemon-entry.js failed to load under plain Node:
${stderr}`)
  }
  if (result.status === 0 || (!inheritStderr && !stderr.includes(DAEMON_USAGE_PREFIX))) {
    throw new Error(
      `[plain-node-entry-guard] daemon-entry.js did not reject an empty argv under plain Node ` +
        `(expected a non-zero exit and the "${DAEMON_USAGE_PREFIX}" error, got exit ` +
        `${result.status}). stderr:\n${stderr}`
    )
  }
}
