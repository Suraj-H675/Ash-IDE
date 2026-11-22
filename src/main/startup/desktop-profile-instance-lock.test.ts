import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireOrcadInstanceLock } from '../orcad/orcad-instance-lock'
import * as rootLocality from '../orcad/orcad-data-root-locality'
import {
  acquireProfileStateRuntimeHost,
  ProfileStateAccessError
} from '../persistence/profile-state/profile-state-access'
import {
  profileStateAccessBootIdentity,
  profileStateAccessMachineIdentity
} from '../persistence/profile-state/profile-state-access-identity'
import {
  profileStateAccessPaths,
  reclaimExitedOwner
} from '../persistence/profile-state/profile-state-access-owner'
import { acquireDesktopProfileInstanceLock } from './desktop-profile-instance-lock'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true })
  }
})

function disposableProfile(): string {
  const profile = mkdtempSync(join(tmpdir(), 'ash-desktop-profile-admission-'))
  fixtures.push(profile)
  return profile
}

/** Exercise the actual desktop lock from a separate Node process, not a stubbed accessor. */
function attemptDesktopAdmission(profile: string): string {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      [
        "const { acquireDesktopProfileInstanceLock } = require('./src/main/startup/desktop-profile-instance-lock.ts')",
        'const result = acquireDesktopProfileInstanceLock(process.argv[1], undefined, () => {})',
        "if (result.state === 'acquired') result.lock.release()",
        'process.stdout.write(result.state)'
      ].join(';'),
      profile
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 }
  )
  expect(child.error).toBeUndefined()
  expect(child.status).toBe(0)
  expect(child.stderr).toBe('')
  return child.stdout
}

function attemptServerHostAdmission(profile: string): string {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      [
        "const { acquireOrcadInstanceLock } = require('./src/main/orcad/orcad-instance-lock.ts')",
        "const { acquireProfileStateRuntimeHost } = require('./src/main/persistence/profile-state/profile-state-access.ts')",
        'const instance = acquireOrcadInstanceLock(process.argv[1])',
        "try { const host = acquireProfileStateRuntimeHost(process.argv[1]); host.release(); process.stdout.write('acquired') } catch { process.stdout.write('refused') } finally { instance.release() }"
      ].join(';'),
      profile
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 }
  )
  expect(child.error).toBeUndefined()
  expect(child.status).toBe(0)
  expect(child.stderr).toBe('')
  return child.stdout
}

describe('RT-15 cross-process desktop profile writer admission', () => {
  it.skipIf(process.platform !== 'linux').each(['different', 'unverifiable'] as const)(
    'refuses a cloned macOS runtime-host owner with %s boot identity, even when its file is old',
    (bootEvidence) => {
      const profile = disposableProfile()
      const paths = profileStateAccessPaths(profile)
      const machineIdentity = profileStateAccessMachineIdentity()
      const currentBoot = profileStateAccessBootIdentity()
      expect(machineIdentity).toBeTruthy()
      expect(currentBoot).toBeTruthy()
      const token = randomUUID()
      mkdirSync(paths.runtimeHost)
      const ownerFile = join(paths.runtimeHost, `${token}.owner`)
      writeFileSync(
        ownerFile,
        JSON.stringify({
          token,
          pid: 2_100_000_000,
          host: hostname(),
          platform: 'darwin',
          pidNamespace: null,
          bootIdentity: bootEvidence === 'different' ? `${currentBoot}-different-boot` : null,
          machineIdentity,
          processStartIdentity: 'darwin-utc-start-ms:1500000000000'
        })
      )
      // Deliberately older than this boot: mtime is not proof that another
      // machine sharing the same identity has stopped writing.
      const oldTime = new Date('2010-01-01T00:00:00Z')
      utimesSync(ownerFile, oldTime, oldTime)
      const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
      try {
        expect(() => reclaimExitedOwner(paths.runtimeHost, true)).toThrow(ProfileStateAccessError)
        expect(existsSync(ownerFile)).toBe(true)
      } finally {
        platform.mockRestore()
      }
    }
  )

  it.skipIf(process.platform !== 'linux').each([
    { storage: 'shared/unknown', local: false },
    { storage: 'verified-local', local: true }
  ])('applies the Linux runtime-host reboot recovery policy on $storage storage', ({ local }) => {
    const profile = disposableProfile()
    const paths = profileStateAccessPaths(profile)
    const token = randomUUID()
    mkdirSync(paths.runtimeHost)
    const ownerFile = join(paths.runtimeHost, `${token}.owner`)
    writeFileSync(
      ownerFile,
      JSON.stringify({
        token,
        pid: 2_100_000_000,
        host: hostname(),
        platform: 'linux',
        pidNamespace: null,
        bootIdentity: `${profileStateAccessBootIdentity()}-different-boot`,
        machineIdentity: profileStateAccessMachineIdentity(),
        processStartIdentity: 'linux-start-ticks:1'
      })
    )
    const oldTime = new Date('2010-01-01T00:00:00Z')
    utimesSync(ownerFile, oldTime, oldTime)
    const storage = vi.spyOn(rootLocality, 'orcadDataRootIsOnLocalDisk').mockReturnValue(local)
    try {
      if (local) {
        const recovered = acquireProfileStateRuntimeHost(profile)
        expect(() => recovered.assertActive()).not.toThrow()
        expect(existsSync(ownerFile)).toBe(false)
        recovered.release()
      } else {
        expect(() => acquireProfileStateRuntimeHost(profile)).toThrow(ProfileStateAccessError)
        expect(existsSync(ownerFile)).toBe(true)
      }
    } finally {
      storage.mockRestore()
    }
  })

  it.each(['darwin', 'win32'] as const)(
    'does not expose the independent Linux runtime-host claim on %s',
    (platformName) => {
      const profile = disposableProfile()
      const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue(platformName)
      try {
        expect(() => acquireProfileStateRuntimeHost(profile)).toThrow('only supported on Linux')
      } finally {
        platform.mockRestore()
      }
    }
  )

  it.each(['darwin', 'win32'] as const)(
    'preserves shared desktop locking without publishing a runtime-host claim on %s',
    (platformName) => {
      const profile = disposableProfile()
      const originalLock = acquireOrcadInstanceLock(profile)
      const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue(platformName)
      try {
        const result = acquireDesktopProfileInstanceLock(
          profile,
          () => originalLock,
          () => {}
        )
        expect(result.state).toBe('acquired')
        expect(existsSync(join(profile, '.profile-state-access', 'runtime-host'))).toBe(false)
        if (result.state === 'acquired') {
          result.lock.release()
        }
      } finally {
        platform.mockRestore()
        originalLock.release()
      }
    }
  )

  it('exits rather than continuing to write after a verified loss of desktop ownership', () => {
    const profile = disposableProfile()
    let onExclusivityLost: (() => void) | undefined
    const intercept: typeof acquireOrcadInstanceLock = (root, hooks) => {
      onExclusivityLost = hooks?.onExclusivityLost
      return acquireOrcadInstanceLock(root, hooks)
    }
    const notify = vi.fn(() => {
      throw new Error('notification service unavailable')
    })
    const result = acquireDesktopProfileInstanceLock(profile, intercept, () => {}, notify)
    expect(result.state).toBe('acquired')
    if (result.state !== 'acquired') {
      return
    }
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('test-only exit')
    })
    try {
      expect(onExclusivityLost).toBeTypeOf('function')
      expect(() => onExclusivityLost?.()).toThrow('test-only exit')
      expect(notify).toHaveBeenCalledOnce()
      expect(exit).toHaveBeenCalledWith(1)
      // The process.exit mock leaves this PID alive: its second owner must
      // remain held until the real exit, not be released by regular cleanup.
      expect(() => acquireProfileStateRuntimeHost(profile)).toThrow()
    } finally {
      exit.mockRestore()
      result.lock.release()
    }
  })

  it.skipIf(process.platform !== 'linux')(
    'refuses a second writer while a real orcad process lock is held',
    () => {
      const profile = disposableProfile()
      const owner = acquireOrcadInstanceLock(profile)
      try {
        expect(attemptDesktopAdmission(profile)).toBe('held')
      } finally {
        owner.release()
      }
      expect(attemptDesktopAdmission(profile)).toBe('acquired')
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'refuses an unreadable lock rather than treating unknown ownership as idle',
    () => {
      const profile = disposableProfile()
      const obstructedLock = join(profile, 'orcad.lock')
      mkdirSync(obstructedLock)
      expect(attemptDesktopAdmission(profile)).toBe('refused')
      rmSync(obstructedLock, { recursive: true })
      expect(attemptDesktopAdmission(profile)).toBe('acquired')
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'refuses a second desktop even if the first host lock file was moved away',
    () => {
      const profile = disposableProfile()
      const first = acquireDesktopProfileInstanceLock(profile, undefined, () => {})
      expect(first.state).toBe('acquired')
      if (first.state !== 'acquired') {
        return
      }
      const displaced = join(profile, 'displaced-runtime-lock')
      renameSync(first.lock.path, displaced)
      try {
        // A new contender can publish orcad.lock, but cannot publish the
        // independent live host owner. The first writer is still running.
        expect(attemptDesktopAdmission(profile)).toBe('refused')
        expect(attemptServerHostAdmission(profile)).toBe('refused')
      } finally {
        renameSync(displaced, first.lock.path)
        first.lock.release()
      }
      expect(attemptDesktopAdmission(profile)).toBe('acquired')
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'refuses a desktop contender while the real server host owner is still live',
    () => {
      const profile = disposableProfile()
      const instance = acquireOrcadInstanceLock(profile)
      const host = acquireProfileStateRuntimeHost(profile)
      const displaced = join(profile, 'displaced-server-lock')
      renameSync(instance.path, displaced)
      try {
        expect(attemptDesktopAdmission(profile)).toBe('refused')
      } finally {
        renameSync(displaced, instance.path)
        host.release()
        instance.release()
      }
      expect(attemptDesktopAdmission(profile)).toBe('acquired')
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'does not block on a FIFO substituted for the lock file',
    () => {
      const profile = disposableProfile()
      const pipe = join(profile, 'orcad.lock')
      const created = spawnSync('mkfifo', [pipe], { timeout: 3_000 })
      expect(created.error).toBeUndefined()
      expect(created.status).toBe(0)
      expect(attemptDesktopAdmission(profile)).toBe('refused')
      rmSync(pipe)
      expect(attemptDesktopAdmission(profile)).toBe('acquired')
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'recovers an orphaned runtime-host owner after a real host process is killed',
    () => {
      const profile = disposableProfile()
      const crashed = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '-e',
          [
            "const fs = require('node:fs')",
            "const { acquireDesktopProfileInstanceLock } = require('./src/main/startup/desktop-profile-instance-lock.ts')",
            'const result = acquireDesktopProfileInstanceLock(process.argv[1], undefined, () => {})',
            "if (result.state !== 'acquired') process.exit(2)",
            "fs.writeSync(1, 'acquired')",
            "process.kill(process.pid, 'SIGKILL')"
          ].join(';'),
          profile
        ],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 }
      )
      expect(crashed.error).toBeUndefined()
      expect(crashed.signal).toBe('SIGKILL')
      expect(crashed.stdout).toBe('acquired')
      // PID/process-start proof is required to reclaim both persistent claims.
      expect(attemptDesktopAdmission(profile)).toBe('acquired')
    }
  )
})
