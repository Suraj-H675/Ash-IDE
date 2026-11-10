import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getAppEnvironment,
  hasAppEnvironment,
  setAppEnvironment,
  type AppEnvironment
} from '../../../../shared/app-environment'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  prepareClaudeProfileDirectory
} from '../../../claude-accounts/claude-profile-paths'
import {
  captureClaudeManagedProfileRouteSelection,
  createClaudeSessionProfileRoutingPin
} from './claude-session-profile-routing-pin'

const ACCOUNT_A = 'route-account-a'
const ACCOUNT_B = 'route-account-b'
const PTY_ID = 'pty-route-pin'
const INCARNATION_A = '11111111-1111-4111-8111-111111111111'
const INCARNATION_B = '22222222-2222-4222-8222-222222222222'

describe.skipIf(process.platform === 'win32')('Claude managed profile session routing pin', () => {
  let root = ''
  let dataRoot = ''
  let userHome = ''
  let profileA: ReturnType<typeof describeClaudeProfile>
  let profileB: ReturnType<typeof describeClaudeProfile>
  let selectedPointerPath = ''
  let foreignSettingsPath = ''
  let foreignSettingsBytes = ''
  let environmentBefore: AppEnvironment | null = null

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

  function settings(selected: string): GlobalSettings {
    return {
      ...getDefaultSettings(userHome),
      claudeManagedAccounts: [managedAccount(ACCOUNT_A), managedAccount(ACCOUNT_B)],
      activeClaudeManagedAccountId: selected,
      activeClaudeManagedAccountIdsByRuntime: { host: selected, wsl: {} }
    }
  }

  function authFor(
    profile: ReturnType<typeof describeClaudeProfile>
  ): ClaudeRuntimeAuthPreparation {
    return {
      configDir: profile.home,
      runtime: 'host',
      envPatch: {
        CLAUDE_CONFIG_DIR: profile.home,
        [CLAUDE_INJECTED_CONFIG_DIR_ENV]: profile.home,
        [CLAUDE_PROFILE_POINTER_ENV]: selectedPointerPath
      },
      // The host verifier deliberately does not use provenance as account authority.
      provenance: `profile:${ACCOUNT_B}`
    }
  }

  function nativeEnvFor(profile: ReturnType<typeof describeClaudeProfile>): Record<string, string> {
    return {
      CLAUDE_CONFIG_DIR: profile.home,
      [CLAUDE_INJECTED_CONFIG_DIR_ENV]: profile.home,
      [CLAUDE_PROFILE_POINTER_ENV]: selectedPointerPath
    }
  }

  async function issuePin(
    selection: Awaited<ReturnType<typeof captureClaudeManagedProfileRouteSelection>>,
    account: ReturnType<typeof describeClaudeProfile>,
    selectedNow = account.accountId
  ) {
    return createClaudeSessionProfileRoutingPin({
      selection,
      currentSettings: settings(selectedNow),
      auth: authFor(account),
      nativeSpawnEnv: nativeEnvFor(account),
      callerEnvironmentOverride: false
    })
  }

  beforeEach(() => {
    root = mkdtempSync(join(realpathSync(tmpdir()), 'ash-claude-route-pin-'))
    dataRoot = join(root, 'ash-private')
    userHome = join(root, 'disposable-user-home')
    mkdirSync(dataRoot, { mode: 0o700 })
    mkdirSync(userHome, { mode: 0o700 })
    profileA = describeClaudeProfile(dataRoot, ACCOUNT_A, {
      executionHostId: 'local',
      runtime: 'host'
    })
    profileB = describeClaudeProfile(dataRoot, ACCOUNT_B, {
      executionHostId: 'local',
      runtime: 'host'
    })
    prepareClaudeProfileDirectory(dataRoot, profileA, userHome)()
    prepareClaudeProfileDirectory(dataRoot, profileB, userHome)()
    selectedPointerPath = join(dataRoot, 'claude-profiles', 'selected-host')
    writeFileSync(selectedPointerPath, `${profileA.home}\n`, { mode: 0o600 })

    const foreignHome = join(root, 'foreign-user', '.claude')
    mkdirSync(foreignHome, { recursive: true, mode: 0o700 })
    foreignSettingsPath = join(foreignHome, 'settings.json')
    foreignSettingsBytes = '{"foreign":"unchanged"}\n'
    writeFileSync(foreignSettingsPath, foreignSettingsBytes, { mode: 0o600 })

    environmentBefore = hasAppEnvironment() ? getAppEnvironment() : null
    setAppEnvironment({
      getPath: (name) => (name === 'userData' ? dataRoot : name === 'home' ? userHome : root),
      getAppPath: () => root,
      getVersion: () => 'test',
      isPackaged: () => false,
      onWillQuit: () => {},
      exit: () => {},
      getAppMetrics: () => []
    })
  })

  afterEach(() => {
    if (environmentBefore) {
      setAppEnvironment(environmentBefore)
    }
    if (root) {
      rmSync(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('pins the first host-selected managed account across a global selection switch', async () => {
    const selection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    expect(selection?.accountId).toBe(ACCOUNT_A)

    writeFileSync(selectedPointerPath, `${profileB.home}\n`, { mode: 0o600 })
    const pin = await issuePin(selection, profileA, ACCOUNT_B)

    expect(pin).not.toBeNull()
    expect(pin?.path).not.toBe(selectedPointerPath)
    expect(pin?.path).toContain(join('claude-profiles', 'session-pins'))
    expect(readFileSync(pin!.path, 'utf8')).toBe(`${profileA.home}\n`)
    expect(lstatSync(dirname(pin!.path)).mode & 0o777).toBe(0o700)
    expect(lstatSync(pin!.path).mode & 0o777).toBe(0o600)
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)

    const nextLaunch = await issuePin(
      await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_B)),
      profileB,
      ACCOUNT_B
    )
    expect(nextLaunch).not.toBeNull()
    expect(nextLaunch?.path).not.toBe(pin?.path)
    expect(readFileSync(nextLaunch!.path, 'utf8')).toBe(`${profileB.home}\n`)
  })

  it('rejects post-assembly native environment changes to the pinned route', async () => {
    const selection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const pin = await issuePin(selection, profileA)
    expect(pin).not.toBeNull()

    const pinnedEnv = { ...nativeEnvFor(profileA), [CLAUDE_PROFILE_POINTER_ENV]: pin!.path }
    expect(() => pin!.assertNativeSpawnEnvironment(pinnedEnv)).not.toThrow()
    expect(() =>
      pin!.assertNativeSpawnEnvironment({ ...pinnedEnv, CLAUDE_CONFIG_DIR: profileB.home })
    ).toThrow('claude_session_profile_routing_pin_environment_mismatch')
    expect(() =>
      pin!.assertNativeSpawnEnvironment({
        ...pinnedEnv,
        [CLAUDE_INJECTED_CONFIG_DIR_ENV]: profileB.home
      })
    ).toThrow('claude_session_profile_routing_pin_environment_mismatch')
    expect(() =>
      pin!.assertNativeSpawnEnvironment({
        ...pinnedEnv,
        [CLAUDE_PROFILE_POINTER_ENV]: selectedPointerPath
      })
    ).toThrow('claude_session_profile_routing_pin_environment_mismatch')

    pin!.cleanupIfUnspawned()
    expect(() => lstatSync(pin!.path)).toThrow()
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })

  it('refuses forged or replaced ownership markers', async () => {
    const selection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const marker = claudeProfileMarkerPath(profileA)
    const forged = `${JSON.stringify({ version: 1, accountId: ACCOUNT_B, runtime: 'host' })}\n`
    writeFileSync(marker, forged, { mode: 0o600 })
    expect(await issuePin(selection, profileA)).toBeNull()

    const correctMarker = `${JSON.stringify({ version: 1, accountId: ACCOUNT_A, runtime: 'host' })}\n`
    writeFileSync(marker, correctMarker, { mode: 0o600 })
    const verifiedSelection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const replacementMarker = `${marker}.replacement`
    writeFileSync(replacementMarker, correctMarker, { mode: 0o600 })
    renameSync(replacementMarker, marker)
    expect(await issuePin(verifiedSelection, profileA)).toBeNull()
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })

  it('requires a verified marker identity before auth preparation begins', async () => {
    const marker = claudeProfileMarkerPath(profileA)
    const validMarker = `${JSON.stringify({ version: 1, accountId: ACCOUNT_A, runtime: 'host' })}\n`
    rmSync(marker)
    const selectionWithoutVerifiedMarker = await captureClaudeManagedProfileRouteSelection(
      settings(ACCOUNT_A)
    )
    expect(selectionWithoutVerifiedMarker?.identityBeforePreparation).toBeNull()

    writeFileSync(marker, validMarker, { mode: 0o600 })
    expect(await issuePin(selectionWithoutVerifiedMarker, profileA)).toBeNull()
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })

  it('refuses a symlinked profile home and a plain replacement at the same path', async () => {
    const symlinkSelection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const symlinkTarget = join(root, 'profile-symlink-target')
    mkdirSync(symlinkTarget, { mode: 0o700 })
    rmSync(profileA.home, { recursive: true, force: true })
    symlinkSync(symlinkTarget, profileA.home, 'dir')
    expect(await issuePin(symlinkSelection, profileA)).toBeNull()

    rmSync(profileA.home, { force: true })
    mkdirSync(profileA.home, { mode: 0o700 })
    const replacementSelection = await captureClaudeManagedProfileRouteSelection(
      settings(ACCOUNT_A)
    )
    expect(replacementSelection).not.toBeNull()
    const previousHome = join(dirname(profileA.home), 'home-before-replacement')
    renameSync(profileA.home, previousHome)
    mkdirSync(profileA.home, { mode: 0o700 })
    expect(await issuePin(replacementSelection, profileA)).toBeNull()
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })

  it('removes an unused failed or adopted launch pin, but retains it through detach until matching exit', async () => {
    const selection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const failed = await issuePin(selection, profileA)
    expect(failed).not.toBeNull()
    const failedPath = failed!.path
    failed!.cleanupIfUnspawned()
    expect(() => lstatSync(failedPath)).toThrow()

    const adopted = await issuePin(selection, profileA)
    expect(adopted).not.toBeNull()
    const adoptedPath = adopted!.path
    // An adopted PTY has no native-spawn callback for this request.
    adopted!.cleanupIfUnspawned()
    expect(() => lstatSync(adoptedPath)).toThrow()

    const active = await issuePin(selection, profileA)
    expect(active).not.toBeNull()
    const activePath = active!.path
    active!.noteNativeSpawnReturned(PTY_ID, INCARNATION_A)
    // Outcome release also runs when the GUI detaches; a live pin is preserved.
    active!.cleanupIfUnspawned()
    active!.cleanupOnPtyExit('another-pty', INCARNATION_A)
    active!.cleanupOnPtyExit(PTY_ID, INCARNATION_B)
    expect(readFileSync(activePath, 'utf8')).toBe(`${profileA.home}\n`)
    active!.cleanupOnPtyExit(PTY_ID, INCARNATION_A)
    expect(() => lstatSync(activePath)).toThrow()
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })

  it('preserves a pin when native dispatch was attempted but no PTY generation returned', async () => {
    const selection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const pin = await issuePin(selection, profileA)
    expect(pin).not.toBeNull()

    pin!.noteNativeSpawnAttempt()
    pin!.noteNativeSpawnCallFailed()
    // A later shell fallback can return a PTY, but it cannot account for the first call.
    pin!.noteNativeSpawnReturned(PTY_ID, INCARNATION_A)
    pin!.cleanupIfUnspawned()
    pin!.cleanupOnPtyExit(PTY_ID, INCARNATION_A)

    expect(readFileSync(pin!.path, 'utf8')).toBe(`${profileA.home}\n`)
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })

  it('does not unlink a replacement file at a pin path', async () => {
    const selection = await captureClaudeManagedProfileRouteSelection(settings(ACCOUNT_A))
    const pin = await issuePin(selection, profileA)
    expect(pin).not.toBeNull()
    const path = pin!.path
    pin!.noteNativeSpawnReturned(PTY_ID, INCARNATION_A)
    rmSync(path)
    writeFileSync(path, 'foreign replacement\n', { mode: 0o600 })

    pin!.cleanupOnPtyExit(PTY_ID, INCARNATION_A)

    expect(readFileSync(path, 'utf8')).toBe('foreign replacement\n')
    expect(readFileSync(foreignSettingsPath, 'utf8')).toBe(foreignSettingsBytes)
  })
})
