import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { observedHostedBrowserBackend } from './orcad-browser-backend-positive-evidence'
import { startOrcadBrowserProvider } from './orcad-browser-startup'

function processState(pid: number): string | null {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function hostedChromiumPids(executable: string, profilePath: string): number[] {
  const rows = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
  return rows.split('\n').flatMap((row) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(row)
    return match &&
      match[2].includes(executable) &&
      match[2].includes(`--user-data-dir=${profilePath}`)
      ? [Number(match[1])]
      : []
  })
}

function hostedChromiumPid(executable: string, profilePath: string): number | null {
  return hostedChromiumPids(executable, profilePath)[0] ?? null
}

function isolateBrowserEnvironment(root: string): () => void {
  mkdirSync(join(root, 'home'))
  const keys = [
    'HOME',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    ...Object.keys(process.env).filter(
      (key) =>
        key.startsWith('AGENT_BROWSER_') ||
        key.startsWith('ORCA_BROWSER_') ||
        key.startsWith('ORCA_E2E_')
    )
  ]
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  process.env.HOME = join(root, 'home')
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  process.env.XDG_CACHE_HOME = join(root, 'cache')
  process.env.XDG_DATA_HOME = join(root, 'data')
  for (const key of keys) {
    if (
      key.startsWith('AGENT_BROWSER_') ||
      key.startsWith('ORCA_BROWSER_') ||
      key.startsWith('ORCA_E2E_')
    ) {
      delete process.env[key]
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

const chromiumExecutable = process.env.ASH_RT15_CHROMIUM_EXECUTABLE
const agentBrowserBinary = process.env.ASH_RT15_AGENT_BROWSER_BINARY
const realBrowserProofEnabled =
  process.platform === 'linux' && Boolean(chromiumExecutable && agentBrowserBinary)
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms))

describe('RT-15 real Chromium child lifetime', () => {
  it.skipIf(!realBrowserProofEnabled)(
    'keeps positive evidence while a disposable hosted browser awaits stop',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'ash-rt15-live-process-'))
      const restoreEnvironment = isolateBrowserEnvironment(root)
      const executable = chromiumExecutable!
      const profilePath = join(root, 'orcad', 'browser-chromium')
      const provider = startOrcadBrowserProvider({
        userDataPath: join(root, 'orcad'),
        resolveInstalledElectronExecutable: async () => null,
        environment: { ORCA_BROWSER_EXECUTABLE: executable }
      })
      let childPid: number | null = null
      let stoppedChild: Promise<void> | undefined

      try {
        await Promise.race([
          provider.ready,
          delay(45_000).then(() => {
            throw new Error('The real Chromium backend did not become ready within 45 seconds.')
          })
        ])
        expect(observedHostedBrowserBackend()).toBe(1)

        const deadline = Date.now() + 10_000
        while (!childPid && Date.now() < deadline) {
          childPid = hostedChromiumPid(executable, profilePath)
          if (!childPid) {
            await delay(100)
          }
        }
        expect(childPid).not.toBeNull()
        process.kill(childPid!, 'SIGSTOP')
        await delay(100)
        expect(processState(childPid!)).toMatch(/^T/)

        let stopSettled = false
        stoppedChild = provider.stop().then(() => {
          stopSettled = true
        })
        await delay(300)
        expect(stopSettled).toBe(false)
        expect(processState(childPid!)).toMatch(/^T/)
        expect(observedHostedBrowserBackend()).toBe(1)

        process.kill(childPid!, 'SIGCONT')
        await stoppedChild
        expect(observedHostedBrowserBackend()).toBe(0)
      } finally {
        if (childPid && processState(childPid)?.startsWith('T')) {
          process.kill(childPid, 'SIGCONT')
        }
        await (stoppedChild ?? provider.stop().catch(() => undefined))
        restoreEnvironment()
        rmSync(root, { recursive: true, force: true })
      }
    },
    70_000
  )

  it.skipIf(!realBrowserProofEnabled)(
    'retains evidence when a failing close helper leaves the real Chromium child alive',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'ash-rt15-close-fault-'))
      const restoreEnvironment = isolateBrowserEnvironment(root)
      const executable = chromiumExecutable!
      const profilePath = join(root, 'orcad', 'browser-chromium')
      const driverPath = join(root, 'agent-browser-close-fault')
      const failCloseMarker = join(root, 'fail-close-enabled')
      const failureObserved = join(root, 'injected-close-failure')
      process.env.ASH_RT15_CLOSE_FAULT_MARKER = failCloseMarker
      process.env.ASH_RT15_CLOSE_FAULT_OBSERVED = failureObserved
      writeFileSync(
        driverPath,
        `#!/bin/sh
input=$(cat)
if [ -f "$ASH_RT15_CLOSE_FAULT_MARKER" ] && printf '%s' "$input" | grep -q close; then : > "$ASH_RT15_CLOSE_FAULT_OBSERVED"; echo injected-close-failure >&2; exit 73; fi
printf '%s\\n' "$input" | exec "$ASH_RT15_AGENT_BROWSER_BINARY" "$@"
`
      )
      chmodSync(driverPath, 0o700)
      const statePath = join(root, 'orcad')
      const provider = startOrcadBrowserProvider({
        userDataPath: statePath,
        resolveInstalledElectronExecutable: async () => null,
        resolveAgentBrowserBinary: () => driverPath,
        environment: { ORCA_BROWSER_EXECUTABLE: executable }
      })

      let childPid: number | null = null
      try {
        await Promise.race([
          provider.ready,
          delay(45_000).then(() => {
            throw new Error('The real Chromium backend did not become ready within 45 seconds.')
          })
        ])
        expect(observedHostedBrowserBackend()).toBe(1)
        childPid = hostedChromiumPid(executable, profilePath)
        expect(childPid).not.toBeNull()
        writeFileSync(failCloseMarker, '')

        await provider.stop()

        expect(existsSync(failureObserved)).toBe(true)
        expect(hostedChromiumPids(executable, profilePath).length).toBeGreaterThan(0)
        expect(observedHostedBrowserBackend()).toBe(1)
      } finally {
        for (const pid of hostedChromiumPids(executable, profilePath)) {
          try {
            process.kill(pid, 'SIGTERM')
          } catch {}
        }
        await delay(500)
        for (const pid of hostedChromiumPids(executable, profilePath)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
        if (childPid && processState(childPid)?.startsWith('T')) {
          process.kill(childPid, 'SIGCONT')
        }
        await provider.stop().catch(() => undefined)
        delete process.env.ASH_RT15_CLOSE_FAULT_MARKER
        delete process.env.ASH_RT15_CLOSE_FAULT_OBSERVED
        restoreEnvironment()
        rmSync(root, { recursive: true, force: true })
      }
    },
    70_000
  )
})
