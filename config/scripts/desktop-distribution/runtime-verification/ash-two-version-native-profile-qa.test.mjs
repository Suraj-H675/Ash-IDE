import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertSelectedImageTree } from './ash-two-version-native-embedded-fixture.mjs'

const require = createRequire(import.meta.url)
const { main, verifyPhase } = require('./ash-two-version-native-profile-qa.cjs')
const pidfdTool = fileURLToPath(new URL('./ash-two-version-native-pidfd.py', import.meta.url))

describe('authenticated runtime identity across phase receipts', () => {
  it('rejects a daemon shutdown receipt from a different runtime generation', () => {
    const fixture = mkdtempSync('/var/tmp/ashcross.')
    chmodSync(fixture, 0o700)
    try {
      writeFileSync(
        join(fixture, '.ash-native-cross-version-fixture'),
        'Test-owned Ash IDE native cross-version fixture\n',
        { mode: 0o600 }
      )
      const phase = 'phase-identity-test'
      const phaseRuntimeId = 'auth-runtime-current'
      const receipts = {
        status: {
          ok: true,
          result: {
            runtime: { appVersion: '0.1.0', state: 'ready', runtimeId: phaseRuntimeId },
            app: { desktopWindowStatus: 'available', pid: 12345 }
          }
        },
        'x11-window': {
          ok: true,
          nativeX11: true,
          class: 'com.ashide.desktop',
          pid: 12345,
          width: 1280,
          height: 800
        },
        settings: { ok: true, settingsRead: true },
        'daemon-stop': {
          ok: true,
          result: { status: 'stopped', killedCount: 0 },
          _meta: { runtimeId: phaseRuntimeId }
        },
        'runtime-stop': {
          ok: true,
          result: { status: 'stopping', runtimeId: phaseRuntimeId }
        },
        'natural-exit': { status: 'exited' }
      }
      for (const [name, receipt] of Object.entries(receipts)) {
        writeFileSync(join(fixture, `${phase}.${name}.json`), JSON.stringify(receipt), {
          mode: 0o600
        })
      }
      expect(verifyPhase(fixture, phase, '0.1.0')).toBe(phaseRuntimeId)
      receipts['daemon-stop']._meta.runtimeId = 'stale-runtime-generation'
      writeFileSync(
        join(fixture, `${phase}.daemon-stop.json`),
        JSON.stringify(receipts['daemon-stop']),
        { mode: 0o600 }
      )
      expect(() => verifyPhase(fixture, phase, '0.1.0')).toThrow(
        /exact authenticated phase runtime/
      )
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

describe('in-image executable and module tree safety', () => {
  const required = new Map([
    ['resources/node-runtime', { kind: 'd' }],
    ['resources/node-modules-unrelated', { kind: 'l' }],
    ['resources/node_modules', { kind: 'd' }],
    ['resources/app.asar.unpacked/out', { kind: 'd' }],
    ['resources/ash-package-input-identity.json', { kind: '-' }]
  ])

  it('accepts regular in-image executable files without blocking unrelated entries', () => {
    const entries = new Map(required)
    entries.set('resources/node-runtime/bin/node', { kind: '-' })
    entries.set('resources/node_modules/zod/index.js', { kind: '-' })
    entries.set('resources/app.asar.unpacked/out/cli/index.js', { kind: '-' })
    expect(() => assertSelectedImageTree(entries)).not.toThrow()
  })

  it.each([
    'resources/node-runtime/bin/node',
    'resources/node_modules/zod',
    'resources/app.asar.unpacked/out/cli/runtime/client.js'
  ])('rejects a symlink at executable dependency %s before extraction', (path) => {
    const entries = new Map(required)
    entries.set(path, { kind: 'l' })
    expect(() => assertSelectedImageTree(entries)).toThrow(/symlink or unsafe entry/)
  })

  it('rejects a symlink replacing a required executable tree or identity file', () => {
    for (const path of ['resources/node-runtime', 'resources/ash-package-input-identity.json']) {
      const entries = new Map(required)
      entries.set(path, { kind: 'l' })
      expect(() => assertSelectedImageTree(entries)).toThrow()
    }
  })
})

describe('native shared-profile QA cleanup boundaries', () => {
  it('refuses a fixture path outside the private authenticated test root', async () => {
    await expect(main(['stop-fixture-daemon', '/tmp/unowned/daemon-v55.pid'])).rejects.toThrow()
  })

  it.skipIf(process.platform !== 'linux')(
    'never signals an unrelated process through daemon, GUI, or Xvfb cleanup',
    async () => {
      const fixture = mkdtempSync('/var/tmp/ashcross.')
      chmodSync(fixture, 0o700)
      writeFileSync(
        join(fixture, '.ash-native-cross-version-fixture'),
        'Test-owned Ash IDE native cross-version fixture\n',
        { mode: 0o600 }
      )
      const daemonDirectory = join(fixture, 'profile', 'daemon')
      mkdirSync(daemonDirectory, { recursive: true, mode: 0o700 })
      const recordPath = join(daemonDirectory, 'daemon-v55.pid')
      const child = spawn('/usr/bin/sleep', ['30'], { stdio: 'ignore' })
      try {
        const record = {
          pid: child.pid,
          linuxStartTicks: readFileSync(`/proc/${child.pid}/stat`, 'utf8')
            .split(') ')
            .at(-1)
            .trim()
            .split(' ')[19]
        }
        writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 })
        await expect(main(['stop-fixture-daemon', recordPath])).rejects.toThrow()
        await expect(
          main(['stop-fixture-app', fixture, String(child.pid), record.linuxStartTicks])
        ).rejects.toThrow()
        await expect(
          main(['stop-fixture-xvfb', fixture, String(child.pid), record.linuxStartTicks])
        ).rejects.toThrow()
        await expect(
          main([
            'stop-fixture-xvfb',
            fixture,
            String(child.pid),
            String(Number(record.linuxStartTicks) + 1)
          ])
        ).rejects.toThrow()
        expect(() => process.kill(child.pid, 0)).not.toThrow()
        // A runtime.stop acknowledgment is insufficient if its exact process
        // is still alive. This must time out without ever sending a signal.
        const unfinishedStop = spawnSync(
          'python3',
          [pidfdTool, 'wait', 'app', fixture, String(child.pid), record.linuxStartTicks],
          { encoding: 'utf8', timeout: 19_000 }
        )
        expect(unfinishedStop.status).not.toBe(0)
        expect(unfinishedStop.stderr).toMatch(/did not exit/)
        expect(() => process.kill(child.pid, 0)).not.toThrow()
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM')
        }
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise((resolve) => child.once('exit', resolve))
        }
        rmSync(fixture, { recursive: true, force: true })
      }
    },
    25_000
  )
})
