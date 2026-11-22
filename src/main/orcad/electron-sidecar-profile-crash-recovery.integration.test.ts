import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as portReservation from './loopback-port-reservation'
import type * as ElectronSidecarProfileModule from './electron-sidecar-profile'

const { spawnFakeSidecar } = vi.hoisted(() => ({ spawnFakeSidecar: vi.fn() }))
type ElectronSidecarProfileExports = typeof ElectronSidecarProfileModule

vi.mock('./electron-sidecar-profile', async (importOriginal) => {
  const actual = await importOriginal<ElectronSidecarProfileExports>()
  return { ...actual, spawnElectronSidecar: spawnFakeSidecar }
})

import { ElectronServeBrowserProcess } from './electron-serve-browser-process'

const FIXTURE_PATH = fileURLToPath(
  new URL('./__fixtures__/fake-orcad-electron-sidecar.cjs', import.meta.url)
)

describe('Electron sidecar profile crash recovery', () => {
  let root: string
  let profiles: string[]
  let children: ChildProcess[]
  let fakeMode: string | undefined
  let fakeMetadata: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-relaunch-'))
    profiles = []
    children = []
    fakeMode = undefined
    fakeMetadata = undefined
    spawnFakeSidecar.mockImplementation((_executablePath: string, userDataPath: string) => {
      expect(
        JSON.parse(readFileSync(join(root, 'browser-sidecar-profile.json'), 'utf8')).profilePath
      ).toBe(userDataPath)
      profiles.push(userDataPath)
      const child = spawn(process.execPath, [FIXTURE_PATH, `--user-data-dir=${userDataPath}`], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          ...(fakeMode ? { ORCA_FAKE_SIDECAR_MODE: fakeMode } : {}),
          ...(fakeMetadata ? { ORCA_FAKE_SIDECAR_METADATA: fakeMetadata } : {})
        }
      })
      children.push(child)
      return child
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await once(child, 'exit').catch(() => undefined)
      }
    }
    for (const profile of profiles) {
      rmSync(profile, { recursive: true, force: true })
    }
    rmSync(root, { recursive: true, force: true })
    spawnFakeSidecar.mockReset()
  })

  it('recovers a new start after IPC disconnect clears the old runtime metadata', async () => {
    const first = new ElectronServeBrowserProcess('fake-electron.exe', root)
    await first.start()
    const oldChild = children[0]
    const oldProfile = profiles[0]
    expect(oldChild).toBeDefined()
    expect(existsSync(join(oldProfile, 'ash-runtime.json'))).toBe(true)

    const oldExit = once(oldChild, 'exit')
    oldChild.disconnect()
    await oldExit
    expect(existsSync(join(oldProfile, 'ash-runtime.json'))).toBe(false)

    const restarted = new ElectronServeBrowserProcess('fake-electron.exe', root)
    await expect(restarted.start()).rejects.toThrow('data was preserved')
    expect(profiles).toHaveLength(1)
    expect(existsSync(oldProfile)).toBe(true)

    await first.stop()
    expect(first.hasHostOwnedCleanup()).toBe(false)
    expect(existsSync(oldProfile)).toBe(false)

    await restarted.start()
    expect(restarted.isAvailable()).toBe(true)
    expect(profiles).toHaveLength(2)
    expect(existsSync(oldProfile)).toBe(false)

    await restarted.stop()
    expect(restarted.hasHostOwnedCleanup()).toBe(false)
    expect(existsSync(profiles[1])).toBe(false)
  })

  it('cleans an allocated profile when port reservation fails before spawn', async () => {
    vi.spyOn(portReservation, 'reserveLoopbackPort').mockRejectedValue(
      new Error('fixture port reservation failure')
    )
    const browser = new ElectronServeBrowserProcess('fake-electron.exe', root)

    await expect(browser.start()).rejects.toThrow('fixture port reservation failure')
    const ownerRecord: { profilePath: string } = JSON.parse(
      readFileSync(join(root, 'browser-sidecar-profile.json'), 'utf8')
    )
    const profile = ownerRecord.profilePath
    expect(existsSync(profile)).toBe(true)
    expect(children).toHaveLength(0)

    await browser.stop()
    expect(browser.hasHostOwnedCleanup()).toBe(false)
    expect(existsSync(profile)).toBe(false)
  })

  it('treats malformed records and unsafe runtime PIDs as startup unknown', async () => {
    fakeMode = 'invalid-metadata-then-exit'
    const validFields = {
      runtimeId: 'fixture-runtime',
      transports: [{ kind: 'unix', endpoint: '/tmp/fixture-runtime.sock' }],
      authToken: null,
      startedAt: Date.now()
    }
    for (const metadata of [
      {},
      { ...validFields, pid: 0 },
      { ...validFields, pid: -1 },
      { ...validFields, pid: 1.5 }
    ]) {
      fakeMetadata = JSON.stringify(metadata)
      const browser = new ElectronServeBrowserProcess('fake-electron.exe', root)

      await expect(browser.start()).rejects.toThrow('no runtime metadata')
      const profile = profiles.at(-1)
      if (!profile) {
        throw new Error('fake sidecar was not spawned')
      }
      expect(existsSync(join(profile, 'ash-runtime.json'))).toBe(true)

      await browser.stop()
      expect(browser.hasHostOwnedCleanup()).toBe(false)
      expect(existsSync(profile)).toBe(false)
    }
  })

  it('keeps cleanup unresolved while a live unowned helper still uses the profile, then retries', async () => {
    const browser = new ElectronServeBrowserProcess('fake-electron.exe', root)
    await browser.start()
    const profile = profiles[0]
    const helper = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}`],
      { stdio: 'ignore' }
    )
    children.push(helper)
    await once(helper, 'spawn')

    await expect(browser.stop()).rejects.toThrow('cleanup remains unresolved')
    expect(browser.hasHostOwnedCleanup()).toBe(true)
    expect(existsSync(profile)).toBe(true)

    helper.kill('SIGKILL')
    await once(helper, 'exit')
    await browser.stop()
    expect(browser.hasHostOwnedCleanup()).toBe(false)
    expect(existsSync(profile)).toBe(false)
  })
})
