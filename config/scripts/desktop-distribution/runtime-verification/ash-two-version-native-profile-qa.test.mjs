import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { main } = require('./ash-two-version-native-profile-qa.cjs')
const pidfdTool = fileURLToPath(new URL('./ash-two-version-native-pidfd.py', import.meta.url))

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
