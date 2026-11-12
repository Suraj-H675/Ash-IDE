#!/usr/bin/env node
// Real bundled plain-Node runtime, authenticated Ash CLI, persistent daemon and
// PTY across a graceful stop/restart. No remote pairing or real user profile.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packagedNodeRuntimePath } from '../../orcad-distribution/prebuilds/build-orcad-node.mjs'
import { currentTarget } from '../../orcad-distribution/prebuilds/server-build-target.mjs'

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const directory = join(root, 'out', 'orcad')
const runtimeNode = packagedNodeRuntimePath(directory, currentTarget())
const serverEntry = join(directory, 'orcad-server.js')
const cliEntry = join(root, 'out', 'cli', 'index.js')
const cliClient = join(root, 'out', 'cli', 'runtime', 'client.js')
const START_MS = 45_000
const STOP_MS = 18_000

if (process.platform !== 'linux') {
  console.error('Linux-only local runtime/PTY smoke')
  process.exit(2)
}
for (const file of [runtimeNode, serverEntry, cliEntry, cliClient]) {
  if (!existsSync(file)) {
    console.error(
      `Missing built runtime artifact ${file}; build:orcad and build:desktop:assets are required`
    )
    process.exit(2)
  }
}

// Short paths satisfy Unix socket limits, and the disk-backed filesystem avoids
// large native caches filling /tmp tmpfs. Keep logs for repeatable QA evidence.
const fixture = mkdtempSync('/var/tmp/ash-orcad-local.')
const profile = join(fixture, 'profile')
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const runtimeDir = join(fixture, 'run')
for (const folder of [
  profile,
  project,
  home,
  runtimeDir,
  join(home, '.config'),
  join(home, '.cache'),
  join(home, '.local', 'share'),
  join(home, '.local', 'state'),
  join(home, '.codex'),
  join(home, '.claude')
]) {
  mkdirSync(folder, { recursive: true, mode: 0o700 })
}
// No provider secrets, account selectors, proxy credentials, or real user
// configuration cross into the disposable host/PTY subprocesses.
const childEnv = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  LANG: process.env.LANG ?? 'C.UTF-8',
  HOME: home,
  XDG_RUNTIME_DIR: runtimeDir,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  XDG_STATE_HOME: join(home, '.local', 'state'),
  CODEX_HOME: join(home, '.codex'),
  CLAUDE_CONFIG_DIR: join(home, '.claude'),
  ORCA_USER_DATA: profile,
  ASH_USER_DATA_PATH: profile
}
process.env.ASH_USER_DATA_PATH = profile
process.env.ORCA_USER_DATA = profile
delete process.env.ORCA_PAIRING_CODE
delete process.env.ORCA_REMOTE_PAIRING
delete process.env.ORCA_ENVIRONMENT
const { RuntimeClient } = createRequire(import.meta.url)(cliClient)
const servers = []
let daemonStopped = false

function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).trim().split(' ')
    if (stat[0] === 'Z' || stat[0] === 'X') {
      return null
    }
    return stat[19] ?? null
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function runCli(args, cwd = project) {
  const launched = spawnSync(runtimeNode, [cliEntry, ...args, '--json'], {
    cwd,
    env: childEnv,
    encoding: 'utf8',
    timeout: 15_000
  })
  assert.equal(
    launched.status,
    0,
    `CLI ${args.join(' ')} failed: ${launched.error?.message ?? launched.stderr ?? launched.stdout}`
  )
  const reply = JSON.parse(launched.stdout)
  assert.equal(reply.ok, true, `CLI ${args.join(' ')} rejected: ${launched.stdout}`)
  return reply.result
}

function launchServer(label) {
  const child = spawn(runtimeNode, [serverEntry, '--port', '0', '--bind', '127.0.0.1', '--json'], {
    cwd: project,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  servers.push(child)
  const stdout = []
  const stderr = []
  const ready = new Promise((resolveReady, rejectReady) => {
    let buffer = ''
    let settled = false
    const settle = (value, error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (error) {
        rejectReady(error)
      } else {
        resolveReady(value)
      }
    }
    const timeout = setTimeout(
      () =>
        settle(
          null,
          new Error(
            `No ash_runtime_ready within ${START_MS} ms; stderr: ${stderr.join('').slice(-2000)}`
          )
        ),
      START_MS
    )
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout.push(chunk)
      buffer += chunk
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index === -1) {
          break
        }
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'ash_runtime_ready') {
            settle(parsed)
          }
        } catch {
          // Only the identified JSON readiness line is a start receipt.
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', (error) => settle(null, error))
    child.once('exit', (code, signal) =>
      settle(
        null,
        new Error(
          `Server exited before ready (${code ?? signal}); stderr: ${stderr.join('').slice(-2000)}`
        )
      )
    )
  })
  child.once('close', () => {
    writeFileSync(join(fixture, `${label}.stdout`), stdout.join(''))
    writeFileSync(join(fixture, `${label}.stderr`), stderr.join(''))
  })
  return { child, ready }
}

async function waitExit(child, timeoutMs = STOP_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise((resolveWait, rejectWait) => {
    const timeout = setTimeout(
      () =>
        rejectWait(new Error(`Test-owned server ${child.pid} did not stop within ${timeoutMs} ms`)),
      timeoutMs
    )
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveWait()
    })
  })
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (processStartTicks(pid) !== null) {
    if (Date.now() >= deadline) {
      throw new Error(`Test-owned process ${pid} is still alive after ${timeoutMs} ms`)
    }
    // The daemon is a detached process, so Node has no child 'exit' event to await.
    // Use a short, strictly bounded lifecycle check rather than treating an RPC
    // shutdown receipt as proof that the OS process already exited.
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGTERM')
  try {
    await waitExit(child, STOP_MS)
  } catch {
    // This is exactly the PID returned by our own spawn, never a process-name kill.
    child.kill('SIGKILL')
    await waitExit(child, 3000).catch(() => undefined)
  }
}

function stopVerifiedFixtureDaemon() {
  const recordFile = join(profile, 'daemon', 'daemon-v55.pid')
  if (!existsSync(recordFile)) {
    return
  }
  const record = JSON.parse(readFileSync(recordFile, 'utf8'))
  const pid = record.pid
  if (processStartTicks(pid) === null) {
    return
  }
  const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
  const identity = processStartTicks(pid)
  if (
    !command.some((arg) => arg.endsWith('/daemon-entry.js')) ||
    command[command.indexOf('--pid-record') + 1] !== recordFile ||
    identity !== record.linuxStartTicks
  ) {
    throw new Error('Refusing to signal daemon: disposable PID record/process identity mismatch')
  }
  process.kill(pid, 'SIGTERM')
}

async function main() {
  let passed = false
  try {
    const first = launchServer('first')
    const firstReady = await first.ready
    assert.ok(firstReady.runtimeId)
    assert.equal(firstReady.health?.terminalDaemon?.state, 'live')
    const firstStatus = runCli(['status'])
    assert.equal(firstStatus.runtime.runtimeId, firstReady.runtimeId)
    assert.equal(firstStatus.runtime.reachable, true)

    const client = new RuntimeClient(profile, 15_000, null, null)
    const registered = await client.call('repo.add', { path: project, kind: 'folder' })
    assert.equal(registered.ok, true)

    const created = runCli(['terminal', 'create', '--command', 'sleep 180'])
    const handle = created.terminal?.handle
    const terminalPid = created.terminal?.processId
    assert.match(handle, /^term_/)
    assert.ok(Number.isInteger(terminalPid) && terminalPid > 0)
    const originalStartTicks = processStartTicks(terminalPid)
    assert.ok(originalStartTicks)
    assert.deepEqual(
      runCli(['terminal', 'list']).terminals.map((t) => t.handle),
      [handle]
    )

    const stopped = runCli(['runtime', 'stop', '--yes'])
    assert.equal(stopped.status, 'stopping')
    assert.equal(stopped.runtimeId, firstReady.runtimeId)
    await waitExit(first.child)
    assert.equal(first.child.exitCode, 0, 'Node host must complete graceful cleanup')
    assert.equal(processStartTicks(terminalPid), originalStartTicks, 'PTY must outlive the runtime')

    const second = launchServer('second')
    const secondReady = await second.ready
    assert.ok(secondReady.runtimeId)
    assert.notEqual(secondReady.runtimeId, firstReady.runtimeId, 'a fresh runtime ID is required')
    assert.equal(
      secondReady.health?.terminalDaemon?.pid,
      firstReady.health?.terminalDaemon?.pid,
      'restarting the runtime must reconnect to the existing terminal daemon'
    )
    const after = runCli(['terminal', 'list'])
    assert.deepEqual(
      after.terminals.map((t) => t.handle),
      [handle]
    )
    assert.equal(processStartTicks(terminalPid), originalStartTicks, 'PTY cannot be replaced')

    const daemon = runCli(['terminal-daemon', 'stop', '--yes'])
    assert.equal(daemon.status, 'stopped')
    assert.equal(daemon.killedCount, 1)
    daemonStopped = true
    await waitForProcessExit(firstReady.health.terminalDaemon.pid)
    await waitForProcessExit(terminalPid)
    assert.equal(runCli(['runtime', 'stop', '--yes']).status, 'stopping')
    await waitExit(second.child)
    assert.equal(second.child.exitCode, 0)
    assert.equal(processStartTicks(first.child.pid), null)
    assert.equal(processStartTicks(second.child.pid), null)
    passed = true
    console.log(
      JSON.stringify({
        status: 'PASS',
        firstRuntimeId: firstReady.runtimeId,
        secondRuntimeId: secondReady.runtimeId,
        terminalHandle: handle,
        terminalPid,
        fixture
      })
    )
  } finally {
    if (!daemonStopped) {
      try {
        if (servers.some((child) => child.exitCode === null && child.signalCode === null)) {
          runCli(['terminal-daemon', 'stop', '--yes'])
        }
      } catch {
        // A failed runtime start can leave the separately hosted daemon alive.
      }
    }
    for (const child of servers) {
      await stopServer(child)
    }
    stopVerifiedFixtureDaemon()
    if (passed) {
      // Keep only runtime readiness/diagnostic evidence. The disposable profile
      // contains a local RPC token and must not persist after successful QA.
      for (const folder of [profile, project, home, runtimeDir]) {
        rmSync(folder, { recursive: true, force: true })
      }
    }
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  console.error(`Evidence retained under ${fixture}`)
  process.exitCode = 1
})
