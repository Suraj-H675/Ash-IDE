import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWindowlessLinuxAgentNotifier } from './windowless-linux-agent-notifier'

function makeHarness(platform: NodeJS.Platform = 'linux') {
  const child = new EventEmitter() as ChildProcess
  child.kill = vi.fn(() => true)
  const launch = vi.fn((_file: string, _args: readonly string[], _options: SpawnOptions) => child)
  const notify = createWindowlessLinuxAgentNotifier({
    platform,
    env: {
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/var/tmp/test-owned-bus',
      XDG_RUNTIME_DIR: '/var/tmp/test-owned-runtime',
      HOME: '/var/tmp/test-owned-home',
      LANG: 'en_US.UTF-8',
      PROVIDER_TOKEN: 'never-forward-a-credential',
      PATH: '/var/tmp/untrusted-user-path'
    },
    spawnProcess: launch
  })
  return { child, launch, notify }
}

describe('windowless Linux agent notification delivery', () => {
  afterEach(() => vi.useRealTimers())
  it('sends a local OS notification with a fixed helper and no shell or provider secrets', async () => {
    const { child, launch, notify } = makeHarness()
    const delivery = notify({ title: '-A review is ready', body: 'Finished the task' })
    expect(launch).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith(
      '/usr/bin/notify-send',
      [
        '--app-name=Ash IDE',
        '--urgency=normal',
        '--expire-time=8000',
        '--',
        '-A review is ready',
        'Finished the task'
      ],
      expect.objectContaining({
        stdio: 'ignore',
        windowsHide: true,
        env: expect.objectContaining({
          DBUS_SESSION_BUS_ADDRESS: 'unix:path=/var/tmp/test-owned-bus',
          XDG_RUNTIME_DIR: '/var/tmp/test-owned-runtime'
        })
      })
    )
    const options = launch.mock.calls[0]?.[2]
    expect(options?.env).not.toHaveProperty('PROVIDER_TOKEN')
    expect(options?.env).not.toHaveProperty('PATH')
    expect(options?.shell).not.toBe(true)
    child.emit('close', 0)
    await expect(delivery).resolves.toBe(true)
  })

  it('refuses platforms without Linux D-Bus or a nonempty title', async () => {
    for (const platform of ['darwin', 'win32'] as NodeJS.Platform[]) {
      const harness = makeHarness(platform)
      await expect(harness.notify({ title: 'Done', body: '' })).resolves.toBe(false)
      expect(harness.launch).not.toHaveBeenCalled()
    }
    const harness = makeHarness()
    await expect(harness.notify({ title: ' ', body: '' })).resolves.toBe(false)
    expect(harness.launch).not.toHaveBeenCalled()
    const spawnProcess = vi.fn()
    const noBus = createWindowlessLinuxAgentNotifier({
      platform: 'linux',
      env: {},
      spawnProcess
    })
    await expect(noBus({ title: 'Done', body: '' })).resolves.toBe(false)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('does not report success if the OS notification service rejects delivery', async () => {
    const { child, notify } = makeHarness()
    const promise = notify({ title: 'Done', body: 'Task' })
    child.emit('close', 1)
    await expect(promise).resolves.toBe(false)
  })

  it('treats a missing notify-send executable as an unsupported result', async () => {
    const { child, notify } = makeHarness()
    const promise = notify({ title: 'Done', body: '' })
    child.emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toBe(false)
  })

  it('bounds title and body lengths before giving them to a system helper', async () => {
    const { child, launch, notify } = makeHarness()
    const promise = notify({ title: 'T'.repeat(300), body: 'B'.repeat(5000) })
    const args = launch.mock.calls[0]?.[1]
    expect(args?.[4]).toHaveLength(256)
    expect(args?.[5]).toHaveLength(4096)
    child.emit('close', 0)
    await expect(promise).resolves.toBe(true)
  })

  it('kills a hung system helper within a bounded time without claiming delivery', async () => {
    vi.useFakeTimers()
    const { child, notify } = makeHarness()
    const promise = notify({ title: 'Done', body: 'Task' })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await expect(promise).resolves.toBe(false)
  })
})
