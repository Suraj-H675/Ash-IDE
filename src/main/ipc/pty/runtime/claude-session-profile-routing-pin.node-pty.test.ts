import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as nodePty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getAppEnvironment,
  hasAppEnvironment,
  setAppEnvironment,
  type AppEnvironment
} from '../../../../shared/app-environment'
import { getDefaultSettings } from '../../../../shared/constants'
import { getPosixClaudeShellFunction } from '../../../../shared/claude-shell-function'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import {
  describeClaudeProfile,
  prepareClaudeProfileDirectory
} from '../../../claude-accounts/claude-profile-paths'
import {
  captureClaudeManagedProfileRouteSelection,
  createClaudeSessionProfileRoutingPin,
  type ClaudeSessionProfileRoutingPin
} from './claude-session-profile-routing-pin'
import { canAshWriteProviderGlobalHooks } from '../../../agent-hooks/ash-hook-ownership-policy'

const ACCOUNT_A = 'route-account-a'
const ACCOUNT_B = 'route-account-b'

function managedAccount(id: string) {
  return {
    id,
    email: `${id}@example.invalid`,
    managedAuthPath: `/unused/${id}`,
    managedAuthRuntime: 'host' as const,
    authMethod: 'unknown' as const,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 0
  }
}

describe.skipIf(process.platform === 'win32')(
  'Claude session profile routing pin native PTY',
  () => {
    let root = ''
    let previousAppEnvironment: AppEnvironment | null = null
    let liveProcesses: nodePty.IPty[] = []
    let nativeSpawnEnvs: Readonly<Record<string, string>>[] = []
    const activePins: ClaudeSessionProfileRoutingPin[] = []

    afterEach(() => {
      for (const proc of liveProcesses) {
        try {
          proc.kill('SIGKILL')
        } catch {
          // Process may already have exited.
        }
      }
      for (const pin of activePins) {
        pin.cleanupIfUnspawned()
      }
      liveProcesses = []
      nativeSpawnEnvs = []
      activePins.length = 0
      if (previousAppEnvironment) {
        setAppEnvironment(previousAppEnvironment)
        previousAppEnvironment = null
      }
      if (root) {
        rmSync(root, { recursive: true, force: true })
        root = ''
      }
    })

    it('keeps a live A native PTY and fake Claude on A after selection switches to B', async () => {
      root = mkdtempSync(join(realpathSync(tmpdir()), 'ash-claude-session-route-pin-native-'))
      const userHome = join(root, 'user-home')
      const userData = join(root, 'ash-user-data')
      const foreignConfigHome = join(userHome, '.claude')
      const foreignSettings = join(foreignConfigHome, 'settings.json')
      mkdirSync(userHome, { mode: 0o700 })
      mkdirSync(userData, { mode: 0o700 })
      mkdirSync(foreignConfigHome, { recursive: true, mode: 0o700 })
      const foreignSettingsBytes = '{"foreign":"untouched"}\n'
      writeFileSync(foreignSettings, foreignSettingsBytes, { mode: 0o600 })

      const profileA = describeClaudeProfile(userData, ACCOUNT_A, {
        executionHostId: 'local',
        runtime: 'host'
      })
      const profileB = describeClaudeProfile(userData, ACCOUNT_B, {
        executionHostId: 'local',
        runtime: 'host'
      })
      prepareClaudeProfileDirectory(userData, profileA, userHome)()
      prepareClaudeProfileDirectory(userData, profileB, userHome)()
      const selectedPointer = join(userData, 'claude-profiles', 'selected-host')
      writeFileSync(selectedPointer, `${profileA.home}\n`, { mode: 0o600 })

      previousAppEnvironment = hasAppEnvironment() ? getAppEnvironment() : null
      setAppEnvironment({
        getPath: (name) => (name === 'userData' ? userData : userHome),
        getAppPath: () => root,
        getVersion: () => 'test',
        isPackaged: () => false,
        onWillQuit: () => {},
        exit: () => {},
        getAppMetrics: () => []
      })

      let selectedAccount = ACCOUNT_A
      const settings = (): GlobalSettings => ({
        ...getDefaultSettings(userHome),
        claudeManagedAccounts: [managedAccount(ACCOUNT_A), managedAccount(ACCOUNT_B)],
        activeClaudeManagedAccountId: selectedAccount,
        activeClaudeManagedAccountIdsByRuntime: { host: selectedAccount, wsl: {} }
      })
      const authFor = (profile: ReturnType<typeof describeClaudeProfile>) => ({
        configDir: profile.home,
        runtime: 'host' as const,
        envPatch: {
          CLAUDE_CONFIG_DIR: profile.home,
          [CLAUDE_INJECTED_CONFIG_DIR_ENV]: profile.home,
          [CLAUDE_PROFILE_POINTER_ENV]: selectedPointer
        },
        provenance: `profile:${profile.accountId}`
      })
      const envFor = (profile: ReturnType<typeof describeClaudeProfile>) => ({
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: userHome,
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        CLAUDE_CONFIG_DIR: profile.home,
        [CLAUDE_INJECTED_CONFIG_DIR_ENV]: profile.home,
        [CLAUDE_PROFILE_POINTER_ENV]: selectedPointer
      })
      const issuePin = async (profile: ReturnType<typeof describeClaudeProfile>) => {
        const selection = await captureClaudeManagedProfileRouteSelection(settings())
        return createClaudeSessionProfileRoutingPin({
          selection,
          currentSettings: settings(),
          auth: authFor(profile),
          nativeSpawnEnv: envFor(profile),
          callerEnvironmentOverride: false
        })
      }
      const writeFakeClaude = (executable: string): void => {
        // Fake CLI reports only its resolved config route; it never reads credentials or connects.
        writeFileSync(
          executable,
          '#!/usr/bin/env node\n' +
            'const fs = require("node:fs")\n' +
            'const profile = fs.readFileSync(process.env.ORCA_CLAUDE_PROFILE_POINTER, "utf8").trim()\n' +
            'process.stdout.write(`FAKE_CLAUDE_ROUTE|${process.env.CLAUDE_CONFIG_DIR}|${profile}\\n`)\n',
          { mode: 0o700 }
        )
        chmodSync(executable, 0o700)
      }
      const nativeEnvFor = (
        profile: ReturnType<typeof describeClaudeProfile>,
        pin: ClaudeSessionProfileRoutingPin
      ): Readonly<Record<string, string>> => {
        const env = { ...envFor(profile), [CLAUDE_PROFILE_POINTER_ENV]: pin.path }
        pin.assertNativeSpawnEnvironment(env)
        return Object.freeze(env)
      }
      const spawnNativePty = (
        env: Readonly<Record<string, string>>,
        pin: ClaudeSessionProfileRoutingPin,
        ptyId: string,
        incarnationId: string,
        onExit: () => void
      ): nodePty.IPty => {
        pin.assertNativeSpawnEnvironment(env)
        nativeSpawnEnvs.push(Object.freeze({ ...env }))
        const proc = nodePty.spawn('/bin/sleep', ['30'], {
          name: 'xterm-256color',
          cols: 100,
          rows: 32,
          cwd: root,
          env: { ...env }
        })
        liveProcesses.push(proc)
        proc.onExit(onExit)
        pin.noteNativeSpawnReturned(ptyId, incarnationId)
        proc.onExit(() => pin.cleanupOnPtyExit(ptyId, incarnationId))
        return proc
      }

      const fakeClaudeA = join(root, 'fake-claude-a.cjs')
      const fakeClaudeB = join(root, 'fake-claude-b.cjs')
      const fakeBin = join(root, 'test-only-bin')
      mkdirSync(fakeBin, { mode: 0o700 })
      writeFakeClaude(fakeClaudeA)
      writeFakeClaude(fakeClaudeB)
      // Held-out behavior: exercise the *real* injected POSIX shell function
      // with a disposable fake `claude` binary, not just direct env injection.
      writeFakeClaude(join(fakeBin, 'claude'))
      const launchThroughAshBashFunction = (env: Readonly<Record<string, string>>): string =>
        execFileSync(
          '/bin/bash',
          ['--noprofile', '--norc', '-c', `${getPosixClaudeShellFunction()}\nclaude`],
          {
            cwd: root,
            encoding: 'utf8',
            env: { ...env, PATH: `${fakeBin}:${env.PATH ?? '/usr/bin:/bin'}` }
          }
        )
      const pinA = await issuePin(profileA)
      expect(pinA).not.toBeNull()
      activePins.push(pinA!)
      const nativeEnvA = nativeEnvFor(profileA, pinA!)
      let processAExited = false
      const processA = spawnNativePty(
        nativeEnvA,
        pinA!,
        'fake-pty-a',
        '11111111-1111-4111-8111-111111111111',
        () => {
          processAExited = true
        }
      )
      expect(processA.pid).toBeGreaterThan(0)
      expect(process.kill(processA.pid, 0)).toBe(true)
      expect(
        execFileSync(process.execPath, [fakeClaudeA], { encoding: 'utf8', env: nativeEnvA })
      ).toBe(`FAKE_CLAUDE_ROUTE|${profileA.home}|${profileA.home}\n`)
      expect(readFileSync(pinA!.path, 'utf8')).toBe(`${profileA.home}\n`)
      expect(launchThroughAshBashFunction(nativeEnvA)).toBe(
        `FAKE_CLAUDE_ROUTE|${profileA.home}|${profileA.home}\n`
      )
      expect(nativeSpawnEnvs[0]?.CLAUDE_CONFIG_DIR).toBe(profileA.home)
      expect(nativeSpawnEnvs[0]?.[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe(profileA.home)
      expect(nativeSpawnEnvs[0]?.[CLAUDE_PROFILE_POINTER_ENV]).toBe(pinA!.path)

      selectedAccount = ACCOUNT_B
      writeFileSync(selectedPointer, `${profileB.home}\n`, { mode: 0o600 })
      expect(
        execFileSync(process.execPath, [fakeClaudeA], { encoding: 'utf8', env: nativeEnvA })
      ).toBe(`FAKE_CLAUDE_ROUTE|${profileA.home}|${profileA.home}\n`)
      expect(readFileSync(pinA!.path, 'utf8')).toBe(`${profileA.home}\n`)
      expect(launchThroughAshBashFunction(nativeEnvA)).toBe(
        `FAKE_CLAUDE_ROUTE|${profileA.home}|${profileA.home}\n`
      )
      expect(nativeSpawnEnvs[0]?.CLAUDE_CONFIG_DIR).toBe(profileA.home)
      expect(processAExited).toBe(false)

      const pinB = await issuePin(profileB)
      expect(pinB).not.toBeNull()
      activePins.push(pinB!)
      const nativeEnvB = nativeEnvFor(profileB, pinB!)
      let processBExited = false
      const processB = spawnNativePty(
        nativeEnvB,
        pinB!,
        'fake-pty-b',
        '22222222-2222-4222-8222-222222222222',
        () => {
          processBExited = true
        }
      )
      expect(processB.pid).toBeGreaterThan(0)
      expect(process.kill(processB.pid, 0)).toBe(true)
      expect(
        execFileSync(process.execPath, [fakeClaudeB], { encoding: 'utf8', env: nativeEnvB })
      ).toBe(`FAKE_CLAUDE_ROUTE|${profileB.home}|${profileB.home}\n`)
      expect(readFileSync(pinB!.path, 'utf8')).toBe(`${profileB.home}\n`)
      expect(launchThroughAshBashFunction(nativeEnvB)).toBe(
        `FAKE_CLAUDE_ROUTE|${profileB.home}|${profileB.home}\n`
      )
      expect(nativeSpawnEnvs[1]?.CLAUDE_CONFIG_DIR).toBe(profileB.home)
      expect(nativeSpawnEnvs[1]?.[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe(profileB.home)
      expect(nativeSpawnEnvs[1]?.[CLAUDE_PROFILE_POINTER_ENV]).toBe(pinB!.path)
      expect(pinB!.path).not.toBe(pinA!.path)
      expect(readFileSync(foreignSettings, 'utf8')).toBe(foreignSettingsBytes)

      // Missing/replaced private pointers must refuse instead of silently
      // running Claude under the user's System-default account. The stub writes
      // a separate sentinel if it was even entered, so an executable failure
      // cannot create a false-positive refusal.
      const entrySentinel = join(root, 'fake-claude-was-entered')
      writeFileSync(
        join(fakeBin, 'claude'),
        '#!/bin/sh\nprintf "entered\\n" >> "$ASH_FAKE_CLAUDE_ENTRY_SENTINEL"\n',
        { mode: 0o700 }
      )
      const attemptThroughShell = (env: Readonly<Record<string, string>>) =>
        spawnSync(
          '/bin/bash',
          ['--noprofile', '--norc', '-c', `${getPosixClaudeShellFunction()}\nclaude`],
          {
            cwd: root,
            encoding: 'utf8',
            env: {
              ...env,
              PATH: `${fakeBin}:${env.PATH ?? '/usr/bin:/bin'}`,
              ASH_FAKE_CLAUDE_ENTRY_SENTINEL: entrySentinel
            }
          }
        )
      const absentRoute = join(
        root,
        'ash-user-data',
        'claude-profiles',
        'session-pins',
        'missing.route'
      )
      const absentAttempt = attemptThroughShell({
        ...nativeEnvA,
        [CLAUDE_PROFILE_POINTER_ENV]: absentRoute
      })
      expect(absentAttempt.status).toBe(1)
      expect(absentAttempt.stdout).toBe('')
      expect(() => readFileSync(entrySentinel)).toThrow()

      const replacedRoute = join(
        root,
        'ash-user-data',
        'claude-profiles',
        'session-pins',
        'replaced.route'
      )
      writeFileSync(replacedRoute, `${profileB.home}\n`, { mode: 0o600 })
      const replacedAttempt = attemptThroughShell({
        ...nativeEnvA,
        [CLAUDE_PROFILE_POINTER_ENV]: replacedRoute
      })
      expect(replacedAttempt.status).toBe(1)
      expect(replacedAttempt.stdout).toBe('')
      expect(() => readFileSync(entrySentinel)).toThrow()

      // A generic interactive pane (the old mutable selector) may still choose
      // System default when that selector is unavailable; it is not a pin.
      const sharedMissingAttempt = attemptThroughShell({
        ...nativeEnvA,
        [CLAUDE_PROFILE_POINTER_ENV]: join(
          root,
          'ash-user-data',
          'claude-profiles',
          'selected-host-missing'
        )
      })
      expect(sharedMissingAttempt.status).toBe(0)
      expect(readFileSync(entrySentinel, 'utf8')).toBe('entered\n')
      rmSync(entrySentinel)

      // Losing the *home* after a valid pin must not make the function create
      // an unverified replacement folder and accidentally launch a new login.
      renameSync(profileA.home, `${profileA.home}.original`)
      const missingHomeAttempt = attemptThroughShell(nativeEnvA)
      expect(missingHomeAttempt.status).toBe(1)
      expect(missingHomeAttempt.stdout).toBe('')
      expect(() => readFileSync(entrySentinel)).toThrow()
      expect(canAshWriteProviderGlobalHooks()).toBe(false)
      expect(processBExited).toBe(false)
    })
  }
)
