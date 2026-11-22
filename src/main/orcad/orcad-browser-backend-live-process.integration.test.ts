import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { observedHostedBrowserBackend } from './orcad-browser-backend-positive-evidence'
import { startOrcadBrowserProvider } from './orcad-browser-startup'

type FixtureProcess = { pid: number; startTime: string; commandLine: string }

function processIdentity(pid: number): FixtureProcess | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')
    const fields = stat
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/)
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter(Boolean)
      .join(' ')
    return { pid, startTime: fields[19], commandLine }
  } catch {
    return null
  }
}

function hostedChromiumProcesses(executable: string, profilePath: string): FixtureProcess[] {
  return readdirSync('/proc', { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      return []
    }
    const identity = processIdentity(Number(entry.name))
    return identity &&
      identity.commandLine.includes(executable) &&
      identity.commandLine.includes(`--user-data-dir=${profilePath}`)
      ? [identity]
      : []
  })
}

function fixtureProcessStillOwned(
  original: FixtureProcess,
  executable: string,
  profilePath: string
): boolean {
  const current = processIdentity(original.pid)
  return Boolean(
    current &&
    current.startTime === original.startTime &&
    current.commandLine.includes(executable) &&
    current.commandLine.includes(`--user-data-dir=${profilePath}`)
  )
}

function isolateBrowserEnvironment(root: string): () => void {
  mkdirSync(join(root, 'home'))
  const keys = [
    'HOME',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'ASH_RT15_CLOSE_GATE',
    'ASH_RT15_CLOSE_REACHED',
    'ASH_RT15_CLOSE_RELEASE',
    'ASH_RT15_CLOSE_FAULT_MARKER',
    'ASH_RT15_CLOSE_FAULT_OBSERVED',
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

function writeCloseGateDriver(
  driverPath: string,
  gatePath: string,
  reachedPath: string,
  releasePath: string
): void {
  writeFileSync(
    driverPath,
    `#!/bin/sh
input=$(cat)
if [ -f "$ASH_RT15_CLOSE_GATE" ] && printf '%s' "$input" | grep -q close; then
  : > "$ASH_RT15_CLOSE_REACHED"
  attempts=0
  while [ ! -f "$ASH_RT15_CLOSE_RELEASE" ] && [ "$attempts" -lt 300 ]; do
    sleep 0.05
    attempts=$((attempts + 1))
  done
  if [ ! -f "$ASH_RT15_CLOSE_RELEASE" ]; then
    echo close-gate-timeout >&2
    exit 74
  fi
fi
printf '%s\\n' "$input" | exec "$ASH_RT15_AGENT_BROWSER_BINARY" "$@"
`
  )
  chmodSync(driverPath, 0o700)
  process.env.ASH_RT15_CLOSE_GATE = gatePath
  process.env.ASH_RT15_CLOSE_REACHED = reachedPath
  process.env.ASH_RT15_CLOSE_RELEASE = releasePath
}

function writeCloseFailureDriver(driverPath: string, gatePath: string, observedPath: string): void {
  writeFileSync(
    driverPath,
    `#!/bin/sh
input=$(cat)
if [ -f "$ASH_RT15_CLOSE_FAULT_MARKER" ] && printf '%s' "$input" | grep -q close; then
  : > "$ASH_RT15_CLOSE_FAULT_OBSERVED"
  echo injected-close-failure >&2
  exit 73
fi
printf '%s\\n' "$input" | exec "$ASH_RT15_AGENT_BROWSER_BINARY" "$@"
`
  )
  chmodSync(driverPath, 0o700)
  process.env.ASH_RT15_CLOSE_FAULT_MARKER = gatePath
  process.env.ASH_RT15_CLOSE_FAULT_OBSERVED = observedPath
}

async function waitForFixtureProcesses(
  executable: string,
  profilePath: string,
  expected: 'present' | 'absent',
  timeoutMs: number
): Promise<FixtureProcess[]> {
  const deadline = Date.now() + timeoutMs
  let current: FixtureProcess[] = []
  while (Date.now() < deadline) {
    current = hostedChromiumProcesses(executable, profilePath)
    if (
      (expected === 'present' && current.length > 0) ||
      (expected === 'absent' && !current.length)
    ) {
      return current
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return current
}

async function stopProviderAndConfirmFixture(
  provider: ReturnType<typeof startOrcadBrowserProvider>,
  executable: string,
  profilePath: string,
  releaseCloseGate?: string
): Promise<boolean> {
  if (releaseCloseGate) {
    writeFileSync(releaseCloseGate, '')
  }
  await provider.stop().catch(() => undefined)
  await provider.stop().catch(() => undefined)
  return (await waitForFixtureProcesses(executable, profilePath, 'absent', 10_000)).length === 0
}

function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

const chromiumExecutable = process.env.ASH_RT15_CHROMIUM_EXECUTABLE
const agentBrowserBinary = process.env.ASH_RT15_AGENT_BROWSER_BINARY
const realBrowserProofEnabled =
  process.platform === 'linux' &&
  Boolean(process.env.DISPLAY && chromiumExecutable && agentBrowserBinary)

afterEach(() => {
  expect(observedHostedBrowserBackend()).toBe(0)
})

describe('RT-15 real Chromium child lifetime', () => {
  it.skipIf(!realBrowserProofEnabled)(
    'keeps positive evidence while a disposable hosted browser awaits stop',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'ash-rt15-live-process-'))
      const restoreEnvironment = isolateBrowserEnvironment(root)
      const executable = chromiumExecutable!
      const profilePath = join(root, 'orcad', 'browser-chromium')
      const driverPath = join(root, 'agent-browser-close-gate')
      const closeGate = join(root, 'close-gate')
      const closeReached = join(root, 'close-reached')
      const closeRelease = join(root, 'close-release')
      writeCloseGateDriver(driverPath, closeGate, closeReached, closeRelease)
      const provider = startOrcadBrowserProvider({
        userDataPath: join(root, 'orcad'),
        resolveInstalledElectronExecutable: async () => null,
        resolveAgentBrowserBinary: () => driverPath,
        environment: { ORCA_BROWSER_EXECUTABLE: executable }
      })
      let fixtureCleaned = false

      try {
        await within(
          provider.ready,
          45_000,
          'The real Chromium backend did not become ready within 45 seconds.'
        )
        expect(observedHostedBrowserBackend()).toBe(1)

        const ownedProcesses = await waitForFixtureProcesses(
          executable,
          profilePath,
          'present',
          10_000
        )
        expect(ownedProcesses.length).toBeGreaterThan(0)
        writeFileSync(closeGate, '')

        let stopSettled = false
        const stopping = provider.stop().then(() => {
          stopSettled = true
        })
        const reachedDeadline = Date.now() + 3_000
        while (!existsSync(closeReached) && Date.now() < reachedDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        expect(existsSync(closeReached)).toBe(true)
        expect(stopSettled).toBe(false)
        expect(observedHostedBrowserBackend()).toBe(1)
        expect(
          ownedProcesses.every((owned) => fixtureProcessStillOwned(owned, executable, profilePath))
        ).toBe(true)

        writeFileSync(closeRelease, '')
        await stopping
        expect(observedHostedBrowserBackend()).toBe(0)
      } finally {
        fixtureCleaned = await stopProviderAndConfirmFixture(
          provider,
          executable,
          profilePath,
          closeRelease
        )
        restoreEnvironment()
        if (fixtureCleaned) {
          rmSync(root, { recursive: true, force: true })
        }
      }
      expect(fixtureCleaned).toBe(true)
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
      writeCloseFailureDriver(driverPath, failCloseMarker, failureObserved)
      const provider = startOrcadBrowserProvider({
        userDataPath: join(root, 'orcad'),
        resolveInstalledElectronExecutable: async () => null,
        resolveAgentBrowserBinary: () => driverPath,
        environment: { ORCA_BROWSER_EXECUTABLE: executable }
      })
      let fixtureCleaned = false

      try {
        await within(
          provider.ready,
          45_000,
          'The real Chromium backend did not become ready within 45 seconds.'
        )
        expect(observedHostedBrowserBackend()).toBe(1)
        const ownedProcesses = await waitForFixtureProcesses(
          executable,
          profilePath,
          'present',
          10_000
        )
        expect(ownedProcesses.length).toBeGreaterThan(0)
        writeFileSync(failCloseMarker, '')

        await provider.stop()

        expect(existsSync(failureObserved)).toBe(true)
        expect(
          ownedProcesses.every((owned) => fixtureProcessStillOwned(owned, executable, profilePath))
        ).toBe(true)
        expect(observedHostedBrowserBackend()).toBe(1)
      } finally {
        rmSync(failCloseMarker, { force: true })
        fixtureCleaned = await stopProviderAndConfirmFixture(provider, executable, profilePath)
        restoreEnvironment()
        if (fixtureCleaned) {
          rmSync(root, { recursive: true, force: true })
        }
      }
      expect(fixtureCleaned).toBe(true)
    },
    70_000
  )
})
