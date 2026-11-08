import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  watch,
  watchFile,
  unwatchFile,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAshClaudeSessionSettings,
  claudeVerifiedArgsWithAshSessionSettings,
  verifyAshClaudeSessionSettings
} from './ash-claude-session-settings'
import { assertClaudeNativeFixtureHasNoManagedLinuxPolicy } from './ash-claude-native-test-host-guard'

/**
 * Opt-in NATIVE test, not a fixture masquerading as provider evidence.
 *
 * Run explicitly with:
 * ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY=/path/to/claude \
 *   CI=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run \
 *   --config config/vitest.config.ts --pool=threads --maxWorkers=1 \
 *   --no-file-parallelism src/main/agent-hooks/session/ash-claude-native-overlay.e2e.test.ts
 *
 * Uses a synthetic API key, loopback-only model endpoint, fresh private HOME
 * and CLAUDE_CONFIG_DIR, and a disposable local hook log. Does not sign in,
 * call the real provider API, modify user/Orca settings, or run a model turn.
 */
const nativeBinary = process.env.ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY?.trim()
const maxStartupMs = 16_000

let root = ''
let ashUserData = ''
let configDir = ''
let eventLog = ''
let providerSettingsPath = ''

function shellQuoted(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`
}

function writeMarkerHook(path: string, marker: string): void {
  writeFileSync(path, `#!/bin/sh\nprintf '${marker}\\n' >> "$ASH_NATIVE_HOOK_LOG"\n`, {
    mode: 0o700
  })
  chmodSync(path, 0o700)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ash-claude-native-hook-'))
  ashUserData = join(root, 'ash-private')
  configDir = join(root, 'foreign-claude-profile')
  eventLog = join(root, 'hook-events.log')
  providerSettingsPath = join(configDir, 'settings.json')
  for (const path of [
    ashUserData,
    configDir,
    join(root, 'home'),
    join(root, 'cache'),
    join(root, 'cwd')
  ]) {
    mkdirSync(path, { mode: 0o700 })
  }
  writeFileSync(eventLog, '', { mode: 0o600 })
  const foreignHook = join(root, 'foreign-hook.sh')
  writeMarkerHook(foreignHook, 'FOREIGN_SESSION_START')
  writeFileSync(
    providerSettingsPath,
    `${JSON.stringify(
      {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: shellQuoted(foreignHook), timeout: 2 }] }
          ]
        },
        permissions: { defaultMode: 'default' }
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
})

afterEach(() => {
  if (root) {
    rmSync(root, { force: true, recursive: true })
  }
})

async function runNativeUntilHooks(
  expectedMarkers: readonly string[],
  cliArgs: string[]
): Promise<{
  markers: string[]
  requests: number
}> {
  assertClaudeNativeFixtureHasNoManagedLinuxPolicy()
  if (!nativeBinary || !isAbsolute(nativeBinary)) {
    throw new Error(
      'Set an absolute ASH_CLAUDE_NATIVE_HOOK_TEST_BINARY to the installed Claude CLI'
    )
  }

  // Even an unexpected model request cannot reach the real provider.
  let requests = 0
  const server = createServer((_request, _response) => {
    requests++
    // Keep the local-only request open while native startup dispatches hooks.
    // A fast error may cancel hook delivery before every source has run.
    // closeAllConnections() releases this fixture connection during teardown.
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('loopback fixture did not bind to a TCP port')
  }

  let child: ReturnType<typeof spawn> | null = null
  const resources: {
    watcher: ReturnType<typeof watch> | null
    statListener: (() => void) | null
  } = { watcher: null, statListener: null }
  let deadline: ReturnType<typeof setTimeout> | null = null
  let stopDeadline: ReturnType<typeof setTimeout> | null = null
  let capturedStderr = ''
  let capturedStdout = ''
  const markers = () => readFileSync(eventLog, 'utf8').trim().split('\n').filter(Boolean)

  try {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: join(root, 'home'),
      CLAUDE_CONFIG_DIR: configDir,
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: join(root, 'cache'),
      ASH_NATIVE_HOOK_LOG: eventLog,
      ANTHROPIC_API_KEY: 'ash-disposable-fake-local-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      LANG: 'C.UTF-8'
    }

    const version = spawnSync(nativeBinary, ['--version'], {
      cwd: join(root, 'cwd'),
      env,
      encoding: 'utf8',
      timeout: 5_000
    })
    expect(version.status).toBe(0)
    expect(version.stdout).toMatch(/Claude Code/)

    child = spawn(
      nativeBinary,
      [...cliArgs, '--print', '--max-turns', '1', '--model', 'claude-sonnet-4-5', 'Say OK.'],
      {
        cwd: join(root, 'cwd'),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    child.stdout?.on('data', (chunk: Buffer) => {
      capturedStdout = (capturedStdout + chunk.toString()).slice(-800)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      capturedStderr = (capturedStderr + chunk.toString()).slice(-800)
    })

    const exited = new Promise<never>((_, reject) => {
      child?.once('error', reject)
      child?.once('exit', (code, signal) => {
        // A failed auth/network attempt is not proof that hooks executed.
        if (!expectedMarkers.every((marker) => markers().includes(marker))) {
          reject(
            new Error(
              `Claude exited ${code}/${signal} before hooks: ${capturedStderr}; ${capturedStdout}`
            )
          )
        }
      })
    })
    const seen = new Promise<void>((resolve) => {
      const check = () => {
        if (expectedMarkers.every((marker) => markers().includes(marker))) {
          resolve()
        }
      }
      resources.watcher = watch(eventLog, check)
      // Vitest's Bun worker can lose/coalesce file append notifications.
      // Bounded file-stat events provide an independent observation path.
      resources.statListener = check
      watchFile(eventLog, { interval: 250 }, check)
      check()
    })
    await Promise.race([
      seen,
      exited,
      new Promise<void>((resolve, reject) => {
        deadline = setTimeout(() => {
          const observed = markers()
          if (expectedMarkers.every((marker) => observed.includes(marker))) {
            resolve()
          } else {
            reject(
              new Error(
                `Claude hooks timeout: markers=${JSON.stringify(observed)}, ` +
                  `loopbackRequests=${requests}, stderr=${capturedStderr}, stdout=${capturedStdout}`
              )
            )
          }
        }, maxStartupMs)
      })
    ])

    return { markers: markers(), requests }
  } finally {
    if (deadline) {
      clearTimeout(deadline)
    }
    resources.watcher?.close()
    if (resources.statListener) {
      unwatchFile(eventLog, resources.statListener)
    }
    if (child) {
      const stopped = new Promise<void>((resolve) => {
        if (child?.exitCode !== null || child?.signalCode !== null) {
          resolve()
          return
        }
        child?.once('exit', () => resolve())
      })
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM') // exact fixture CLI child only
      }
      await Promise.race([
        stopped,
        new Promise<void>((resolve) => {
          stopDeadline = setTimeout(() => {
            if (child?.exitCode === null && child.signalCode === null) {
              child.kill('SIGKILL')
            }
            resolve()
          }, 2000)
        })
      ])
    }
    if (stopDeadline) {
      clearTimeout(stopDeadline)
    }
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe.skipIf(process.platform !== 'linux' || !nativeBinary)(
  'native Claude SessionStart hook coexistence using disposable settings',
  () => {
    it('executes both foreign user-profile hooks and Ash session overlay hooks', async () => {
      const foreignBefore = readFileSync(providerSettingsPath, 'utf8')
      const script = join(root, 'ash-overlay-hook.sh')
      writeMarkerHook(script, 'ASH_SESSION_START')
      const record = await createAshClaudeSessionSettings({
        ashUserData,
        sessionId: randomUUID(),
        hooks: [{ event: 'SessionStart', scriptPath: script, timeoutSeconds: 2 }]
      })
      await verifyAshClaudeSessionSettings(ashUserData, record)

      const result = await runNativeUntilHooks(
        ['FOREIGN_SESSION_START', 'ASH_SESSION_START'],
        await claudeVerifiedArgsWithAshSessionSettings(ashUserData, record.sessionId, [])
      )
      expect(result.markers).toContain('FOREIGN_SESSION_START')
      expect(result.markers).toContain('ASH_SESSION_START')
      expect(readFileSync(providerSettingsPath, 'utf8')).toBe(foreignBefore)
      await verifyAshClaudeSessionSettings(ashUserData, record)
    }, 25_000)

    it('executes foreign hook alone when Ash session settings are not supplied', async () => {
      const foreignBefore = readFileSync(providerSettingsPath, 'utf8')
      const result = await runNativeUntilHooks(['FOREIGN_SESSION_START'], [])
      expect(result.markers).toContain('FOREIGN_SESSION_START')
      expect(result.markers).not.toContain('ASH_SESSION_START')
      expect(readFileSync(providerSettingsPath, 'utf8')).toBe(foreignBefore)
    }, 25_000)
  }
)
