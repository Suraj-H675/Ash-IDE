import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as secureFile from '../../shared/secure-file'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import {
  createElectronSidecarProfile,
  confirmElectronSidecarCleanup,
  electronSidecarIsAvailable,
  electronSidecarPid,
  removeNeverLaunchedElectronSidecarProfile,
  removeLeftoverElectronSidecarProfile,
  stopElectronSidecar
} from './electron-sidecar-profile'
import { readSidecarProfileUse } from './electron-sidecar-profile-process-evidence'

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
    // SAFETY: stopElectronSidecar reads only these ChildProcess fields before its bounded timeout.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial child fixture
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
    expect(child.kill).toHaveBeenCalledTimes(1)
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

  it('preserves a markerless open profile after the owner loses its child handle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-markerless-'))
    let profilePath: string | undefined
    let holder: ChildProcess | undefined
    const contents = 'live browser profile data'
    try {
      profilePath = await createElectronSidecarProfile(root)
      const dataPath = join(profilePath, 'open-profile-data.json')
      writeFileSync(dataPath, contents)
      holder = spawn(
        process.execPath,
        [
          '-e',
          'const fs=require("node:fs"); const fd=fs.openSync(process.env.ASH_PROFILE_HOLD_FILE,"r"); process.send("opened"); process.on("message",m=>{if(m==="read") process.send(fs.readFileSync(fd,"utf8"))}); setInterval(()=>{},1000)'
        ],
        {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...process.env, ASH_PROFILE_HOLD_FILE: dataPath }
        }
      )
      const opened = once(holder, 'message')
      await once(holder, 'spawn')
      const [openedMessage] = await opened
      expect(openedMessage).toBe('opened')
      expect(holder.exitCode).toBeNull()

      const processListing = await new Promise<string>((resolve, reject) => {
        const child = spawn('ps', ['-ww', '-p', String(holder?.pid), '-o', 'command='], {
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let output = ''
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
        child.once('error', reject)
        child.once('close', (code) =>
          code === 0 ? resolve(output.trim()) : reject(new Error(`ps exited ${code}`))
        )
      })
      expect(processListing).not.toContain(profilePath)

      const evidence = await readSidecarProfileUse(profilePath)
      const removed = await removeLeftoverElectronSidecarProfile(root)
      holder.send('read')
      const [heldContents] = await once(holder, 'message')

      expect({ evidence, removed, profileExists: existsSync(dataPath), heldContents }).toEqual({
        evidence: 'absent',
        removed: false,
        profileExists: true,
        heldContents: contents
      })
    } finally {
      if (holder && holder.exitCode === null && holder.signalCode === null) {
        holder.kill('SIGKILL')
        await once(holder, 'exit')
      }
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a stale path-only profile when owner process evidence is gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-stale-'))
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

  it('keeps the prior owner record intact when restricted publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-acl-retry-'))
    const oldProfile = await createElectronSidecarProfile(root)
    const recordPath = join(root, 'browser-sidecar-profile.json')
    const oldRecord = readFileSync(recordPath, 'utf8')
    rmSync(oldProfile, { recursive: true, force: true })
    const writer = vi.spyOn(secureFile, 'writeDurableSecureJsonFile').mockReturnValue(false)
    try {
      await expect(createElectronSidecarProfile(root)).rejects.toThrow(
        'Could not verify private permissions'
      )
      expect(readFileSync(recordPath, 'utf8')).toBe(oldRecord)

      writer.mockRestore()
      const retryProfile = await createElectronSidecarProfile(root)
      expect(JSON.parse(readFileSync(recordPath, 'utf8')).profilePath).toBe(retryProfile)
      rmSync(retryProfile, { recursive: true, force: true })
    } finally {
      writer.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a profile path replacement when owner record publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-acl-race-'))
    const oldProfile = await createElectronSidecarProfile(root)
    const recordPath = join(root, 'browser-sidecar-profile.json')
    const oldRecord = readFileSync(recordPath, 'utf8')
    rmSync(oldProfile, { recursive: true, force: true })
    let attemptedProfilePath: string | undefined
    let displacedPath: string | undefined
    const writer = vi
      .spyOn(secureFile, 'writeDurableSecureJsonFile')
      .mockImplementation((_path, value) => {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('profilePath' in value) ||
          typeof value.profilePath !== 'string'
        ) {
          throw new Error('unexpected owner record')
        }
        attemptedProfilePath = value.profilePath
        displacedPath = join(tmpdir(), `${basename(value.profilePath)}-displaced`)
        renameSync(value.profilePath, displacedPath)
        mkdirSync(value.profilePath, { mode: 0o700 })
        writeFileSync(join(value.profilePath, 'replacement-data.json'), 'keep this replacement')
        return false
      })
    try {
      await expect(createElectronSidecarProfile(root)).rejects.toThrow(
        'Could not verify private permissions'
      )
      expect(attemptedProfilePath).toBeDefined()
      expect(readFileSync(recordPath, 'utf8')).toBe(oldRecord)
      expect(readFileSync(join(attemptedProfilePath ?? '', 'replacement-data.json'), 'utf8')).toBe(
        'keep this replacement'
      )
      expect(existsSync(displacedPath ?? '')).toBe(true)
    } finally {
      writer.mockRestore()
      if (attemptedProfilePath) {
        rmSync(attemptedProfilePath, { recursive: true, force: true })
      }
      if (displacedPath) {
        rmSync(displacedPath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes a profile that was allocated but never passed to a child process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-never-launched-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(join(profilePath, 'profile-data.json'), 'never launched')

      await expect(removeNeverLaunchedElectronSidecarProfile(root, profilePath)).resolves.toBe(true)
      expect(existsSync(profilePath)).toBe(false)
      expect(existsSync(join(root, 'browser-sidecar-profile.json'))).toBe(true)
    } finally {
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a durable GC intent after deletion fails and retries it on startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-gc-retry-'))
    let profilePath: string | undefined
    let child: ChildProcess | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(join(profilePath, 'profile-data.json'), 'retry me')
      child = spawn(
        process.execPath,
        ['-e', 'process.once("disconnect",()=>process.exit(0)); setInterval(()=>{},1000)'],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32' }
      )
      await once(child, 'spawn')
      const operations = {
        renameProfile: renameSync,
        removeTree: async () => {
          throw new Error('simulated transient deletion failure')
        }
      }

      await expect(
        confirmElectronSidecarCleanup(child, root, true, async () => 'absent', operations)
      ).resolves.toBe(false)
      const intent: { quarantinePath: string } = JSON.parse(
        readFileSync(join(root, 'browser-sidecar-profile-gc.json'), 'utf8')
      )
      expect(existsSync(profilePath)).toBe(false)
      expect(readFileSync(join(intent.quarantinePath, 'profile-data.json'), 'utf8')).toBe(
        'retry me'
      )
      expect(existsSync(join(root, 'browser-sidecar-profile.json'))).toBe(true)

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(true)
      expect(existsSync(intent.quarantinePath)).toBe(false)
      expect(existsSync(join(root, 'browser-sidecar-profile-gc.json'))).toBe(false)
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.disconnect()
        await once(child, 'exit')
      }
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restores a path replacement that wins immediately before quarantine rename', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-rename-race-'))
    let profilePath: string | undefined
    let displacedPath: string | undefined
    let child: ChildProcess | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(join(profilePath, 'original-data.json'), 'original')
      child = spawn(
        process.execPath,
        ['-e', 'process.once("disconnect",()=>process.exit(0)); setInterval(()=>{},1000)'],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32' }
      )
      await once(child, 'spawn')
      const recordedProfilePath = profilePath
      displacedPath = join(tmpdir(), `${basename(recordedProfilePath)}-displaced`)
      const displacedProfilePath = displacedPath
      let swapped = false
      const operations = {
        renameProfile: (source: string, destination: string) => {
          if (!swapped && source === recordedProfilePath) {
            swapped = true
            renameSync(source, displacedProfilePath)
            mkdirSync(source, { mode: 0o700 })
            writeFileSync(join(source, 'replacement-data.json'), 'replacement')
          }
          renameSync(source, destination)
        },
        removeTree
      }

      await expect(
        confirmElectronSidecarCleanup(child, root, true, async () => 'absent', operations)
      ).resolves.toBe(false)
      expect(readFileSync(join(displacedPath, 'original-data.json'), 'utf8')).toBe('original')
      expect(readFileSync(join(profilePath, 'replacement-data.json'), 'utf8')).toBe('replacement')
      expect(existsSync(join(root, 'browser-sidecar-profile-gc.json'))).toBe(true)
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.disconnect()
        await once(child, 'exit')
      }
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      if (displacedPath) {
        rmSync(displacedPath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves both directories when the recorded profile path is swapped during cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-dir-race-'))
    let profilePath: string | undefined
    let displacedPath: string | undefined
    let child: ChildProcess | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      const originalDataPath = join(profilePath, 'original-profile-data.json')
      writeFileSync(originalDataPath, 'original profile data')
      child = spawn(
        process.execPath,
        ['-e', 'process.once("disconnect",()=>process.exit(0)); setInterval(()=>{},1000)'],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32' }
      )
      await once(child, 'spawn')
      const recordedProfilePath = profilePath
      displacedPath = join(tmpdir(), `${basename(recordedProfilePath)}-displaced`)
      const displacedProfilePath = displacedPath
      const raceReadUse = async () => {
        renameSync(recordedProfilePath, displacedProfilePath)
        mkdirSync(recordedProfilePath, { mode: 0o700 })
        writeFileSync(join(recordedProfilePath, 'replacement-data.json'), 'replacement data')
        return 'absent' as const
      }

      await expect(confirmElectronSidecarCleanup(child, root, true, raceReadUse)).resolves.toBe(
        false
      )
      expect(readFileSync(join(displacedPath, 'original-profile-data.json'), 'utf8')).toBe(
        'original profile data'
      )
      expect(readFileSync(join(profilePath, 'replacement-data.json'), 'utf8')).toBe(
        'replacement data'
      )
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.disconnect()
        await once(child, 'exit')
      }
      if (profilePath) {
        rmSync(profilePath, { recursive: true, force: true })
      }
      if (displacedPath) {
        rmSync(displacedPath, { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves an orphan even when stale metadata names an unrelated live PID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-recycled-pid-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(
        join(profilePath, 'ash-runtime.json'),
        JSON.stringify({ runtimeId: 'stale', pid: process.pid })
      )

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
      expect(existsSync(profilePath)).toBe(true)
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

  it('preserves a profile when its durable GC intent is malformed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ash-electron-sidecar-invalid-gc-record-'))
    let profilePath: string | undefined
    try {
      profilePath = await createElectronSidecarProfile(root)
      writeFileSync(join(profilePath, 'profile-data.json'), 'keep this data')
      writeFileSync(join(root, 'browser-sidecar-profile-gc.json'), JSON.stringify({ profilePath }))

      await expect(removeLeftoverElectronSidecarProfile(root)).resolves.toBe(false)
      expect(readFileSync(join(profilePath, 'profile-data.json'), 'utf8')).toBe('keep this data')
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
