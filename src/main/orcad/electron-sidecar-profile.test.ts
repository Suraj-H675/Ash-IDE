import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createElectronSidecarProfile,
  electronSidecarIsAvailable,
  electronSidecarPid,
  removeLeftoverElectronSidecarProfile,
  stopElectronSidecar
} from './electron-sidecar-profile'

afterEach(() => {
  vi.useRealTimers()
})

describe('Electron sidecar stop confirmation', () => {
  it('waits for the owned child process to exit after sending SIGTERM', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)'],
      { stdio: 'ignore' }
    )

    try {
      await once(child, 'spawn')
      await expect(stopElectronSidecar(child)).resolves.toBe('confirmed')
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await once(child, 'exit')
      }
    }
  })

  it('retains an unresolved result when owned-child signals fail and no exit is observed', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 47_321,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => {
        throw new Error('signal denied')
      })
    }) as unknown as ChildProcess

    vi.useFakeTimers()
    const stopping = stopElectronSidecar(child)
    await vi.advanceTimersByTimeAsync(10_100)

    await expect(stopping).resolves.toBe('unresolved')
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })

  it('preserves a live unowned process using the profile even without valid runtime metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-live-profile-'))
    let profilePath: string | undefined
    let unowned: ChildProcess | undefined
    const kill = vi.spyOn(process, 'kill')
    try {
      profilePath = await createElectronSidecarProfile(root)
      unowned = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profilePath}`],
        { stdio: 'ignore' }
      )
      await once(unowned, 'spawn')

      for (const metadata of [undefined, {}, { pid: 0 }, { pid: -1 }, { pid: 1.5 }]) {
        const metadataPath = join(profilePath, 'ash-runtime.json')
        if (metadata === undefined) {
          rmSync(metadataPath, { force: true })
        } else {
          writeFileSync(metadataPath, JSON.stringify(metadata))
        }
        await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
        expect(existsSync(profilePath)).toBe(true)
      }
      expect(kill.mock.calls.some(([pid]) => pid === unowned?.pid)).toBe(false)
    } finally {
      kill.mockRestore()
      if (unowned && unowned.exitCode === null && unowned.signalCode === null) {
        unowned.kill('SIGKILL')
        await once(unowned, 'exit')
      }
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recovers a stale path-only profile when runtime metadata is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-stale-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(true)
      expect(existsSync(profilePath)).toBe(false)
    } finally {
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not mistake an unrelated live process PID for sidecar ownership', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-recycled-pid-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(
        join(profilePath, 'ash-runtime.json'),
        JSON.stringify({ runtimeId: 'stale', pid: process.pid })
      )

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(true)
      expect(existsSync(profilePath)).toBe(false)
    } finally {
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves the profile when its owner record has the wrong shape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-invalid-record-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(join(root, 'browser-sidecar-profile.json'), JSON.stringify({}))

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
      expect(existsSync(profilePath)).toBe(true)
    } finally {
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'preserves the profile when its owner record is replaced by a symlink',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-symlink-record-'))
      let profilePath: string | undefined
      try {
        profilePath = await createElectronSidecarProfile(root)
        const recordPath = join(root, 'browser-sidecar-profile.json')
        const externalRecordPath = join(root, 'external-record.json')
        writeFileSync(externalRecordPath, JSON.stringify({ profilePath }), { mode: 0o600 })
        unlinkSync(recordPath)
        symlinkSync(externalRecordPath, recordPath)

        await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
        expect(existsSync(profilePath)).toBe(true)
      } finally {
        if (profilePath) {
          rmSync(profilePath, { recursive: true, force: true })
        }
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it('rejects unsafe runtime PIDs before availability probes or PID reporting', () => {
    const kill = vi.spyOn(process, 'kill')
    try {
      for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(electronSidecarIsAvailable(null, pid)).toBe(false)
        expect(electronSidecarPid(null, pid)).toBeNull()
      }
      expect(kill).not.toHaveBeenCalled()
    } finally {
      kill.mockRestore()
    }
  })
})
