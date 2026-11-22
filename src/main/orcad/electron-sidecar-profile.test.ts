import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createElectronSidecarProfile,
  removeLeftoverElectronSidecarProfile,
  stopElectronSidecar
} from './electron-sidecar-profile'
import { writeRuntimeMetadata } from '../runtime/rpc/server/runtime-metadata'

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

  it('preserves a live orphan profile without signaling its numeric PID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-profile-'))
    let profilePath: string | undefined
    const kill = vi.spyOn(process, 'kill')
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeRuntimeMetadata(profilePath, {
        runtimeId: 'fixture-runtime',
        pid: process.pid,
        transports: [],
        authToken: null,
        startedAt: Date.now()
      })

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
      expect(existsSync(profilePath)).toBe(true)
      expect(kill.mock.calls.every(([pid, signal]) => pid === process.pid && signal === 0)).toBe(
        true
      )
    } finally {
      kill.mockRestore()
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves an orphan profile when runtime metadata cannot identify its process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-unknown-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
      expect(existsSync(profilePath)).toBe(true)
    } finally {
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
