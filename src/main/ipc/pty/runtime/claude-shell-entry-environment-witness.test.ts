import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePty from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAppEnvironment,
  hasAppEnvironment,
  setAppEnvironment,
  type AppEnvironment
} from '../../../../shared/app-environment'
import { getDefaultSettings } from '../../../../shared/constants'
import { CLAUDE_PROFILE_POINTER_ENV } from '../../../../shared/claude-profile-routing'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { Store } from '../../../persistence/loading-store/store'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import { spawnPtyFromRuntimeController } from './spawn'
import { makeRuntimePtySpawnTestDeps } from './spawn-preflight-test-deps-fixture'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { LocalPtyProvider } from '../../../providers/local-pty/local-pty-provider'
import { getLocalPtyProvider, setLocalPtyProvider } from '../provider/registry'
import { canAshWriteProviderGlobalHooks } from '../../../agent-hooks/ash-hook-ownership-policy'
import {
  beginClaudeShellEntryEnvironmentSnapshot,
  createClaudeShellEntryEnvironmentObserver,
  hasCallerClaudeShellEnvironmentOverride,
  prepareClaudeShellEntryEnvironmentWitness
} from './claude-shell-entry-environment-witness'
import {
  readCommittedLocalPtySpawnEvidence,
  retireCommittedLocalPtySpawnEvidence
} from './committed-local-pty-spawn-evidence'
import { isPtyIncarnationId } from '../../../../shared/terminal/pty/lifecycle/pty-incarnation'

vi.mock('../../../../shared/jcode-runtime-dir', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../shared/jcode-runtime-dir')>()
  return { ...original, ensureJcodeRuntimeDir: vi.fn().mockResolvedValue(undefined) }
})

const ACCOUNT_ID = 'claude-managed-fixture'
const PTY_TAB = 'witness-tab'
const PTY_LEAF = '11111111-1111-4111-8111-111111111111'
const PTY_PANE_KEY = makePaneKey(PTY_TAB, PTY_LEAF)
const PTY_WORKTREE = 'repo::/witness-worktree'
const LAUNCH_TOKEN = 'caller-supplied-fixture-launch-token'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('Claude shell-entry environment witness', () => {
  let root = ''
  let userData = ''
  let configDir = ''
  let pointerPath = ''
  let environmentBefore: AppEnvironment | null = null
  let selectedAccountId: string | null = ACCOUNT_ID

  function settings() {
    return {
      ...getDefaultSettings(root),
      activeClaudeManagedAccountId: selectedAccountId
    }
  }

  function pointerContent(value = configDir): void {
    writeFileSync(pointerPath, value, { mode: 0o600 })
  }

  function makeContext(callerEnvironmentOverride = false) {
    const getSettings = () => settings()
    const before = beginClaudeShellEntryEnvironmentSnapshot(getSettings)
    const auth = {
      configDir,
      runtime: 'host' as const,
      envPatch: {
        CLAUDE_CONFIG_DIR: configDir,
        [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
      },
      provenance: `profile:${ACCOUNT_ID}`
    }
    const after = beginClaudeShellEntryEnvironmentSnapshot(getSettings)
    return {
      context: prepareClaudeShellEntryEnvironmentWitness({
        before,
        after,
        auth,
        callerEnvironmentOverride
      }),
      getSettings
    }
  }

  function observe(
    context: ReturnType<typeof makeContext>['context'],
    getSettings: ReturnType<typeof makeContext>['getSettings'],
    env: Readonly<Record<string, string>>,
    mutateBetween?: () => void,
    platform: NodeJS.Platform = process.platform
  ) {
    const capture = createClaudeShellEntryEnvironmentObserver(context, getSettings, platform)
    capture.observer({
      ptyId: 'pty-shell-entry',
      incarnationId: '8c169b4c-d109-4ce4-9be0-a8da5d3b1bd7',
      phase: 'before',
      attempt: 'primary',
      env
    })
    mutateBetween?.()
    capture.observer({
      ptyId: 'pty-shell-entry',
      incarnationId: '8c169b4c-d109-4ce4-9be0-a8da5d3b1bd7',
      phase: 'after',
      attempt: 'primary',
      env
    })
    return capture.read()
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ash-shell-entry-witness-'))
    userData = join(root, 'ash-user-data')
    configDir = join(root, 'managed-claude-home')
    pointerPath = join(userData, 'claude-profiles', 'selected-host')
    mkdirSync(configDir, { recursive: true })
    mkdirSync(join(userData, 'claude-profiles'), { recursive: true, mode: 0o700 })
    pointerContent()
    environmentBefore = hasAppEnvironment() ? getAppEnvironment() : null
    setAppEnvironment({
      getPath: (name) => (name === 'userData' || name === 'home' ? userData : root),
      getAppPath: () => root,
      getVersion: () => 'test',
      isPackaged: () => false,
      onWillQuit: () => {},
      exit: () => {},
      getAppMetrics: () => []
    })
    selectedAccountId = ACCOUNT_ID
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'inherited-foreign-claude-home'))
  })

  afterEach(() => {
    if (environmentBefore) {
      setAppEnvironment(environmentBefore)
    }
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('fingerprints the effective native shell-entry value and marks a matching prepared route consistency-only', () => {
    const { context, getSettings } = makeContext()
    const witness = observe(context, getSettings, {
      CLAUDE_CONFIG_DIR: configDir,
      [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
    })

    expect(witness).toMatchObject({
      kind: 'consistency-only',
      ptyId: 'pty-shell-entry',
      incarnationId: '8c169b4c-d109-4ce4-9be0-a8da5d3b1bd7',
      nativeSpawnAttempt: 'primary',
      configDirStatus: 'set',
      configDirPathSha256: hash(configDir),
      configDirSource: 'prepared',
      comparison: 'matched',
      selector: 'stable',
      selectedHostPointer: 'stable',
      accountEvidence: { status: 'missing' }
    })
    expect(JSON.stringify(witness)).not.toContain(configDir)
    expect(JSON.stringify(witness)).not.toContain(ACCOUNT_ID)
    expect(JSON.stringify(witness)).not.toContain(LAUNCH_TOKEN)
  })

  it.each([
    [
      'missing',
      () => ({ [CLAUDE_PROFILE_POINTER_ENV]: pointerPath }),
      'missing',
      'none',
      'missing'
    ],
    [
      'empty',
      () => ({ CLAUDE_CONFIG_DIR: '', [CLAUDE_PROFILE_POINTER_ENV]: pointerPath }),
      'empty',
      'none',
      'empty'
    ],
    [
      'inherited',
      () => ({
        CLAUDE_CONFIG_DIR: join(root, 'inherited-foreign-claude-home'),
        [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
      }),
      'set',
      'inherited',
      'mismatched'
    ],
    [
      'different path',
      () => ({
        CLAUDE_CONFIG_DIR: join(root, 'different-home'),
        [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
      }),
      'set',
      'other',
      'mismatched'
    ]
  ] as const)(
    'reports %s without retaining its raw value',
    (_name, envFactory, status, source, comparison) => {
      const { context, getSettings } = makeContext()
      const witness = observe(context, getSettings, envFactory())
      expect(witness).toMatchObject({
        configDirStatus: status,
        configDirSource: source,
        comparison,
        accountEvidence: { status: 'missing' }
      })
      expect(JSON.stringify(witness)).not.toContain(join(root, 'inherited-foreign-claude-home'))
      expect(JSON.stringify(witness)).not.toContain(join(root, 'different-home'))
    }
  )

  it('refuses the prepared-home comparison when an explicit caller env override exists', () => {
    const { context, getSettings } = makeContext(true)
    expect(
      observe(context, getSettings, {
        CLAUDE_CONFIG_DIR: configDir,
        [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
      })
    ).toMatchObject({
      comparison: 'refused-caller-override',
      configDirSource: 'caller-override',
      accountEvidence: { status: 'missing' }
    })
  })

  it('detects config-home overrides in caller env and per-account launch env', () => {
    expect(hasCallerClaudeShellEnvironmentOverride({ env: { CLAUDE_CONFIG_DIR: configDir } })).toBe(
      true
    )
    expect(
      hasCallerClaudeShellEnvironmentOverride({
        launchConfig: { agentEnv: { [CLAUDE_PROFILE_POINTER_ENV]: pointerPath } }
      })
    ).toBe(true)
    expect(hasCallerClaudeShellEnvironmentOverride({ env: { HOME: root } })).toBe(false)
    expect(
      hasCallerClaudeShellEnvironmentOverride({ env: { claude_config_dir: configDir } }, 'win32')
    ).toBe(true)
    expect(
      hasCallerClaudeShellEnvironmentOverride(
        { launchConfig: { agentEnv: { [CLAUDE_PROFILE_POINTER_ENV.toLowerCase()]: pointerPath } } },
        'win32'
      )
    ).toBe(true)
  })

  it('reads case-insensitive Windows environment keys and refuses duplicate spellings', () => {
    const overridden = makeContext(true)
    expect(
      observe(
        overridden.context,
        overridden.getSettings,
        {
          claude_config_dir: configDir,
          [CLAUDE_PROFILE_POINTER_ENV.toLowerCase()]: pointerPath
        },
        undefined,
        'win32'
      )
    ).toMatchObject({
      configDirStatus: 'set',
      configDirPathSha256: hash(configDir),
      configDirSource: 'caller-override',
      comparison: 'refused-caller-override'
    })

    const ambiguous = makeContext()
    expect(
      observe(
        ambiguous.context,
        ambiguous.getSettings,
        {
          CLAUDE_CONFIG_DIR: configDir,
          claude_config_dir: join(root, 'other-home'),
          [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
        },
        undefined,
        'win32'
      )
    ).toMatchObject({
      configDirStatus: 'ambiguous',
      configDirPathSha256: null,
      comparison: 'unavailable'
    })
  })

  it('refuses a selected account change before or during native spawn', () => {
    const getSettings = () => settings()
    const before = beginClaudeShellEntryEnvironmentSnapshot(getSettings)
    selectedAccountId = 'different-managed-account'
    const auth = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir, [CLAUDE_PROFILE_POINTER_ENV]: pointerPath },
      provenance: `profile:${ACCOUNT_ID}`
    }
    const context = prepareClaudeShellEntryEnvironmentWitness({
      before,
      after: beginClaudeShellEntryEnvironmentSnapshot(getSettings),
      auth,
      callerEnvironmentOverride: false
    })
    expect(
      observe(context, getSettings, {
        CLAUDE_CONFIG_DIR: configDir,
        [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
      })
    ).toMatchObject({ comparison: 'refused-selection-change', selector: 'changed' })

    selectedAccountId = ACCOUNT_ID
    const stable = makeContext()
    const changedDuringSpawn = observe(
      stable.context,
      stable.getSettings,
      { CLAUDE_CONFIG_DIR: configDir, [CLAUDE_PROFILE_POINTER_ENV]: pointerPath },
      () => {
        selectedAccountId = 'different-managed-account'
      }
    )
    expect(changedDuringSpawn).toMatchObject({
      comparison: 'refused-selection-change',
      selector: 'changed'
    })
  })

  it('refuses a selected-host pointer change before or during native spawn', () => {
    const beforeNativeSpawn = makeContext()
    pointerContent(join(root, 'another-selected-home'))
    expect(
      observe(beforeNativeSpawn.context, beforeNativeSpawn.getSettings, {
        CLAUDE_CONFIG_DIR: configDir,
        [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
      })
    ).toMatchObject({ comparison: 'refused-pointer-change', selectedHostPointer: 'changed' })

    pointerContent()
    const duringNativeSpawn = makeContext()
    const changedDuringSpawn = observe(
      duringNativeSpawn.context,
      duringNativeSpawn.getSettings,
      { CLAUDE_CONFIG_DIR: configDir, [CLAUDE_PROFILE_POINTER_ENV]: pointerPath },
      () => pointerContent(join(root, 'replacement-selected-home'))
    )
    expect(changedDuringSpawn).toMatchObject({
      comparison: 'refused-pointer-change',
      selectedHostPointer: 'changed'
    })
  })

  it('fails closed when the Ash pointer file is replaced by a symlink and never upgrades account evidence', () => {
    const { context, getSettings } = makeContext()
    rmSync(pointerPath)
    symlinkSync(join(root, 'foreign-pointer-target'), pointerPath)
    const witness = observe(context, getSettings, {
      CLAUDE_CONFIG_DIR: configDir,
      [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
    })
    expect(witness).toMatchObject({
      comparison: 'unavailable',
      selectedHostPointer: 'unavailable',
      accountEvidence: { status: 'missing' }
    })
  })

  it('fails closed when the selected-host pointer exceeds its bounded snapshot size', () => {
    pointerContent('x'.repeat(8193))
    const { context, getSettings } = makeContext()
    const witness = observe(context, getSettings, {
      CLAUDE_CONFIG_DIR: configDir,
      [CLAUDE_PROFILE_POINTER_ENV]: pointerPath
    })
    expect(witness).toMatchObject({
      comparison: 'unavailable',
      selectedHostPointer: 'unavailable',
      accountEvidence: { status: 'missing' }
    })
  })

  it.skipIf(process.platform === 'win32')(
    'observes the actual node-pty shell spawn and stores only its config-home fingerprint',
    async () => {
      const originalAppEnvironment = getAppEnvironment()
      const originalProvider = getLocalPtyProvider()
      const testHome = join(root, 'isolated-home')
      const foreignConfigDir = join(testHome, '.claude')
      const fakeBin = join(root, 'fake-bin')
      const testConfigDir = join(root, 'ash-managed-claude')
      const fakeProviderUserData = join(root, 'native-spawn-user-data')
      const fakePointerPath = join(fakeProviderUserData, 'claude-profiles', 'selected-host')
      mkdirSync(foreignConfigDir, { recursive: true })
      mkdirSync(fakeBin, { recursive: true })
      mkdirSync(testConfigDir, { recursive: true })
      mkdirSync(join(fakeProviderUserData, 'claude-profiles'), { recursive: true, mode: 0o700 })
      const foreignSettings = join(foreignConfigDir, 'settings.json')
      writeFileSync(foreignSettings, '{"foreign":"untouched"}\n', { mode: 0o600 })
      pointerContent(configDir)
      writeFileSync(join(fakeBin, 'claude'), '#!/bin/sh\nexec /bin/sleep 30\n', { mode: 0o700 })
      chmodSync(join(fakeBin, 'claude'), 0o700)
      writeFileSync(fakePointerPath, testConfigDir, { mode: 0o600 })
      setAppEnvironment({
        ...originalAppEnvironment,
        getPath: (name) => (name === 'userData' ? fakeProviderUserData : testHome)
      })
      vi.stubEnv('HOME', testHome)
      vi.stubEnv('USERPROFILE', testHome)
      vi.stubEnv('CLAUDE_CONFIG_DIR', foreignConfigDir)
      const originalForeignSettings = readFileSync(foreignSettings, 'utf8')
      const paneSession = {
        tabsByWorktree: {
          [PTY_WORKTREE]: [{ id: PTY_TAB, worktreeId: PTY_WORKTREE }]
        },
        terminalLayoutsByTabId: {
          [PTY_TAB]: { root: { type: 'leaf', leafId: PTY_LEAF }, ptyIdsByLeafId: {} }
        },
        terminalPtyIncarnationsByPaneKey: {}
      } as {
        tabsByWorktree: Record<string, { id: string; worktreeId: string }[]>
        terminalLayoutsByTabId: Record<
          string,
          { root: { type: 'leaf'; leafId: string }; ptyIdsByLeafId: Record<string, string> }
        >
        terminalPtyIncarnationsByPaneKey: Record<string, string>
      }
      const store = {
        getWorkspaceSession: () => paneSession,
        persistPtyBinding: vi.fn(async (input: unknown) => {
          const args = typeof input === 'function' ? input() : input
          if (
            !args ||
            typeof args !== 'object' ||
            !('ptyId' in args) ||
            !('incarnationId' in args)
          ) {
            return false
          }
          paneSession.terminalLayoutsByTabId[PTY_TAB]!.ptyIdsByLeafId[PTY_LEAF] = String(args.ptyId)
          paneSession.terminalPtyIncarnationsByPaneKey[PTY_PANE_KEY] = String(args.incarnationId)
          return true
        })
      } as unknown as Store
      const exitListeners = new Map<string, () => void>()
      const runtime = {
        registerPty: vi.fn(),
        subscribeToPtyExit: vi.fn((ptyId: string, listener: () => void) => {
          exitListeners.set(ptyId, listener)
          return () => exitListeners.delete(ptyId)
        })
      }
      const settingsForLaunch = {
        ...getDefaultSettings(testHome),
        activeClaudeManagedAccountId: ACCOUNT_ID
      }
      const provider = new LocalPtyProvider({
        getDefaultShell: () => '/bin/bash',
        isHistoryEnabled: () => false,
        onExit: (ptyId) => exitListeners.get(ptyId)?.()
      })
      const deps = {
        ...makeRuntimePtySpawnTestDeps('/bin/bash'),
        getSettings: () => settingsForLaunch,
        prepareClaudeAuth: async () => ({
          configDir: testConfigDir,
          runtime: 'host' as const,
          envPatch: {
            CLAUDE_CONFIG_DIR: testConfigDir,
            [CLAUDE_PROFILE_POINTER_ENV]: fakePointerPath
          },
          provenance: `profile:${ACCOUNT_ID}`
        }),
        adoptStablePane: async (
          adoptArgs: Parameters<PtyRuntimeControllerDeps['adoptStablePane']>[0]
        ) => {
          if (!adoptArgs.spawnFresh) {
            throw new Error('fixture requires a fresh-spawn callback')
          }
          await adoptArgs.spawnFresh({ mustExist: false })
          return null
        },
        store,
        runtime: runtime as unknown as OrcaRuntimeService
      }
      let spawnedPtyId: string | null = null
      let spawnedIncarnationId: string | null = null
      let nativeSpawnConfigDirSha256: string | null = null
      const nativePtySpawn = nodePty.spawn
      const nativePtySpawnSpy = vi
        .spyOn(nodePty, 'spawn')
        .mockImplementation((file, args, options) => {
          nativeSpawnConfigDirSha256 = options.env?.CLAUDE_CONFIG_DIR
            ? hash(options.env.CLAUDE_CONFIG_DIR)
            : null
          return nativePtySpawn(file, args, options)
        })
      try {
        setLocalPtyProvider(provider)
        const response = await spawnPtyFromRuntimeController(deps, {
          cols: 100,
          rows: 32,
          cwd: root,
          command: 'claude',
          launchAgent: 'claude',
          worktreeId: PTY_WORKTREE,
          tabId: PTY_TAB,
          leafId: PTY_LEAF,
          persistHostSessionBinding: true,
          launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
          launchToken: LAUNCH_TOKEN,
          env: {
            ORCA_AGENT_LAUNCH_TOKEN: LAUNCH_TOKEN,
            PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
            HOME: testHome
          }
        })
        spawnedPtyId = response.id
        expect(isPtyIncarnationId(response.incarnationId)).toBe(true)
        spawnedIncarnationId = response.incarnationId ?? null
        if (!spawnedIncarnationId) {
          throw new Error('native local PTY did not return an incarnation')
        }
        const processInfo = (await provider.listProcesses({ ptyIds: [response.id] }))[0]
        expect(processInfo?.rootProcessId).toBeGreaterThan(0)
        expect(nativeSpawnConfigDirSha256).toBe(hash(testConfigDir))
        const receipt = readCommittedLocalPtySpawnEvidence(
          runtime as unknown as OrcaRuntimeService,
          response.id,
          spawnedIncarnationId
        )
        expect(receipt).toMatchObject({
          ptyId: response.id,
          incarnationId: response.incarnationId,
          shellEntryEnvironment: {
            kind: 'consistency-only',
            ptyId: response.id,
            incarnationId: response.incarnationId,
            configDirStatus: 'set',
            configDirPathSha256: hash(testConfigDir),
            configDirSource: 'prepared',
            comparison: 'matched',
            selector: 'stable',
            selectedHostPointer: 'stable',
            accountEvidence: { status: 'missing' }
          },
          accountEvidence: { status: 'missing' }
        })
        expect(JSON.stringify(receipt)).not.toContain(testConfigDir)
        expect(JSON.stringify(receipt)).not.toContain(foreignConfigDir)
        expect(JSON.stringify(receipt)).not.toContain(LAUNCH_TOKEN)
        expect(readFileSync(foreignSettings, 'utf8')).toBe(originalForeignSettings)
        expect(canAshWriteProviderGlobalHooks()).toBe(false)
      } finally {
        nativePtySpawnSpy.mockRestore()
        if (spawnedPtyId) {
          await provider.shutdown(spawnedPtyId, { immediate: true }).catch(() => {})
          retireCommittedLocalPtySpawnEvidence(
            runtime as unknown as OrcaRuntimeService,
            spawnedPtyId,
            spawnedIncarnationId ?? ''
          )
        }
        setLocalPtyProvider(originalProvider)
        setAppEnvironment(originalAppEnvironment)
        vi.unstubAllEnvs()
      }
    }
  )
})
