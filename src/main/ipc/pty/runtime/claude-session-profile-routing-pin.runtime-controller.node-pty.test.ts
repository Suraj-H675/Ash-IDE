import * as nodePty from 'node-pty'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { Store } from '../../../persistence/loading-store/store'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  prepareClaudeProfileDirectory
} from '../../../claude-accounts/claude-profile-paths'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import { spawnPtyFromRuntimeController } from './spawn'
import { makeRuntimePtySpawnTestDeps } from './spawn-preflight-test-deps-fixture'
import { LocalPtyProvider } from '../../../providers/local-pty/local-pty-provider'
import { getLocalPtyProvider, setLocalPtyProvider } from '../provider/registry'
import { canAshWriteProviderGlobalHooks } from '../../../agent-hooks/ash-hook-ownership-policy'

const ACCOUNT_A = 'runtime-route-account-a'
const ACCOUNT_B = 'runtime-route-account-b'
const WORKTREE_ID = 'repo::/claude-route-runtime-worktree'
const LAUNCH_TOKEN = 'disposable-runtime-claude-launch-token'
const PANE_A = {
  tabId: 'claude-route-runtime-tab-a',
  leafId: '11111111-1111-4111-8111-111111111111'
}
const PANE_B = {
  tabId: 'claude-route-runtime-tab-b',
  leafId: '22222222-2222-4222-8222-222222222222'
}
const PANE_REFUSED = {
  tabId: 'claude-route-runtime-tab-refused',
  leafId: '33333333-3333-4333-8333-333333333333'
}

type NativeSpawnCapture = {
  process: nodePty.IPty
  file: string
  args: string[]
  env: Readonly<Record<string, string>>
}

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

function writeFakeClaude(executable: string): void {
  writeFileSync(
    executable,
    '#!/bin/sh\n' +
      'printf "%s\\n" "$$" > "$ASH_FAKE_CLAUDE_PID_FILE"\n' +
      'printf "FAKE_CLAUDE_ROUTE|%s|%s|%s\\n" "$CLAUDE_CONFIG_DIR" "$ORCA_CLAUDE_INJECTED_CONFIG_DIR" "$(cat "$ORCA_CLAUDE_PROFILE_POINTER")"\n' +
      'exec /bin/sleep 60\n',
    { mode: 0o700 }
  )
}

describe.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
  'Claude profile routing through the runtime controller and native local PTY',
  () => {
    let root = ''
    let userHome = ''
    let userData = ''
    let profileA: ReturnType<typeof describeClaudeProfile>
    let profileB: ReturnType<typeof describeClaudeProfile>
    let selectedPointer = ''
    let foreignSettings = ''
    let foreignSettingsBytes = ''
    let appEnvironmentBefore: AppEnvironment | null = null
    let provider: LocalPtyProvider | null = null
    let originalProvider: ReturnType<typeof getLocalPtyProvider> | null = null
    let nativeSpawnSpy: ReturnType<typeof vi.spyOn> | null = null
    let unsubscribeData: (() => void) | null = null
    let unsubscribeExit: (() => void) | null = null
    let replaceMarkerOnNextAuth = false
    const spawnedPtyIds: string[] = []
    const nativeSpawns: NativeSpawnCapture[] = []
    const outputByPty = new Map<string, string>()
    const exitedPtyIds = new Set<string>()
    let selectedAccountId = ACCOUNT_A
    let currentPaneBinding: typeof PANE_A | null = null

    const settings = (): GlobalSettings => ({
      ...getDefaultSettings(userHome),
      terminalScopeHistoryByWorktree: false,
      claudeManagedAccounts: [managedAccount(ACCOUNT_A), managedAccount(ACCOUNT_B)],
      activeClaudeManagedAccountId: selectedAccountId,
      activeClaudeManagedAccountIdsByRuntime: { host: selectedAccountId, wsl: {} }
    })

    afterEach(async () => {
      if (provider) {
        await Promise.all(
          spawnedPtyIds.map((id) => provider?.shutdown(id, { immediate: true }).catch(() => {}))
        )
        provider.killAll()
      }
      unsubscribeData?.()
      unsubscribeData = null
      unsubscribeExit?.()
      unsubscribeExit = null
      nativeSpawnSpy?.mockRestore()
      nativeSpawnSpy = null
      if (originalProvider) {
        setLocalPtyProvider(originalProvider)
        originalProvider = null
      }
      if (appEnvironmentBefore) {
        setAppEnvironment(appEnvironmentBefore)
        appEnvironmentBefore = null
      }
      vi.unstubAllEnvs()
      spawnedPtyIds.length = 0
      nativeSpawns.length = 0
      outputByPty.clear()
      exitedPtyIds.clear()
      provider = null
      if (root) {
        rmSync(root, { recursive: true, force: true })
        root = ''
      }
    })

    it('pins A in a live runtime-created PTY, launches B independently, and refuses changed profile identity', async () => {
      root = mkdtempSync(join(realpathSync(tmpdir()), 'ash-claude-route-runtime-'))
      userHome = join(root, 'disposable-home')
      userData = join(root, 'ash-user-data')
      const fakeBin = join(root, 'fake-bin')
      const wrapperHome = join(userHome, '.claude')
      mkdirSync(userHome, { mode: 0o700 })
      mkdirSync(userData, { mode: 0o700 })
      mkdirSync(fakeBin, { mode: 0o700 })
      mkdirSync(wrapperHome, { mode: 0o700 })
      // Bash's Orca wrapper sources /etc/profile before ~/.profile. Keep the
      // fake binary first after login-profile PATH rewrites, never a real CLI.
      writeFileSync(
        join(userHome, '.profile'),
        `export PATH=${JSON.stringify(`${fakeBin}:/usr/bin:/bin`)}\n`,
        {
          mode: 0o600
        }
      )
      foreignSettings = join(wrapperHome, 'settings.json')
      foreignSettingsBytes = '{"foreign":"fixture-sentinel"}\n'
      writeFileSync(foreignSettings, foreignSettingsBytes, { mode: 0o600 })

      profileA = describeClaudeProfile(userData, ACCOUNT_A, {
        executionHostId: 'local',
        runtime: 'host'
      })
      profileB = describeClaudeProfile(userData, ACCOUNT_B, {
        executionHostId: 'local',
        runtime: 'host'
      })
      prepareClaudeProfileDirectory(userData, profileA, userHome, wrapperHome)()
      prepareClaudeProfileDirectory(userData, profileB, userHome, wrapperHome)()
      selectedPointer = join(userData, 'claude-profiles', 'selected-host')
      writeFileSync(selectedPointer, `${profileA.home}\n`, { mode: 0o600 })

      const fakeClaude = join(fakeBin, 'claude')
      writeFakeClaude(fakeClaude)
      const pidFileA = join(root, 'fake-claude-a.pid')
      const pidFileB = join(root, 'fake-claude-b.pid')
      const pidFileRefused = join(root, 'fake-claude-refused.pid')

      appEnvironmentBefore = hasAppEnvironment() ? getAppEnvironment() : null
      setAppEnvironment({
        getPath: (name) => (name === 'userData' ? userData : userHome),
        getAppPath: () => root,
        getVersion: () => 'test',
        isPackaged: () => false,
        onWillQuit: () => {},
        exit: () => {},
        getAppMetrics: () => []
      })
      vi.stubEnv('ORCA_USER_DATA_PATH', userData)
      vi.stubEnv('CLAUDE_CONFIG_DIR', wrapperHome)

      const paneSession = {
        tabsByWorktree: {
          [WORKTREE_ID]: [
            { id: PANE_A.tabId, worktreeId: WORKTREE_ID },
            { id: PANE_B.tabId, worktreeId: WORKTREE_ID },
            { id: PANE_REFUSED.tabId, worktreeId: WORKTREE_ID }
          ]
        },
        terminalLayoutsByTabId: {
          [PANE_A.tabId]: {
            root: { type: 'leaf', leafId: PANE_A.leafId },
            ptyIdsByLeafId: {}
          },
          [PANE_B.tabId]: {
            root: { type: 'leaf', leafId: PANE_B.leafId },
            ptyIdsByLeafId: {}
          },
          [PANE_REFUSED.tabId]: {
            root: { type: 'leaf', leafId: PANE_REFUSED.leafId },
            ptyIdsByLeafId: {}
          }
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
          const binding = typeof input === 'function' ? input() : input
          if (
            !binding ||
            typeof binding !== 'object' ||
            !('ptyId' in binding) ||
            !('incarnationId' in binding) ||
            !currentPaneBinding
          ) {
            return false
          }
          const { tabId, leafId } = currentPaneBinding
          const layout = paneSession.terminalLayoutsByTabId[tabId]
          if (!layout) {
            return false
          }
          layout.ptyIdsByLeafId[leafId] = String(binding.ptyId)
          paneSession.terminalPtyIncarnationsByPaneKey[makePaneKey(tabId, leafId)] = String(
            binding.incarnationId
          )
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
      const profileForSelection = () => (selectedAccountId === ACCOUNT_A ? profileA : profileB)
      const deps: PtyRuntimeControllerDeps = {
        ...makeRuntimePtySpawnTestDeps('/bin/bash'),
        getSettings: settings,
        prepareClaudeAuth: async (): Promise<ClaudeRuntimeAuthPreparation> => {
          const profile = profileForSelection()
          if (replaceMarkerOnNextAuth) {
            replaceMarkerOnNextAuth = false
            const marker = claudeProfileMarkerPath(profileA)
            const replacement = `${marker}.held-for-fixture`
            const markerBytes = readFileSync(marker)
            renameSync(marker, replacement)
            writeFileSync(marker, markerBytes, { mode: 0o600 })
          }
          return {
            configDir: profile.home,
            runtime: 'host',
            envPatch: {
              CLAUDE_CONFIG_DIR: profile.home,
              [CLAUDE_INJECTED_CONFIG_DIR_ENV]: profile.home,
              [CLAUDE_PROFILE_POINTER_ENV]: selectedPointer
            },
            provenance: `disposable-managed-profile:${profile.accountId}`
          }
        },
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

      provider = new LocalPtyProvider({
        getDefaultShell: () => '/bin/bash',
        isHistoryEnabled: () => false,
        onExit: (ptyId) => exitListeners.get(ptyId)?.()
      })
      originalProvider = getLocalPtyProvider()
      setLocalPtyProvider(provider)
      unsubscribeData = provider.onData(({ id, data }) => {
        outputByPty.set(id, `${outputByPty.get(id) ?? ''}${data}`)
      })
      unsubscribeExit = provider.onExit(({ id }) => exitedPtyIds.add(id))

      const nativePtySpawn = nodePty.spawn
      nativeSpawnSpy = vi.spyOn(nodePty, 'spawn').mockImplementation((file, args, options) => {
        const proc = nativePtySpawn(file, args, options)
        const nativeEnv: Record<string, string> = {}
        for (const [key, value] of Object.entries(options.env ?? {})) {
          if (typeof value === 'string') {
            nativeEnv[key] = value
          }
        }
        const capture: NativeSpawnCapture = {
          process: proc,
          file,
          args: Array.isArray(args) ? args : [args],
          env: Object.freeze(nativeEnv)
        }
        nativeSpawns.push(capture)
        return proc
      })

      const launch = async (
        pane: typeof PANE_A,
        pidFile: string
      ): Promise<{ id: string; incarnationId?: string }> => {
        currentPaneBinding = pane
        try {
          const response = await spawnPtyFromRuntimeController(deps, {
            cols: 100,
            rows: 32,
            cwd: root,
            command: 'claude',
            launchAgent: 'claude',
            worktreeId: WORKTREE_ID,
            tabId: pane.tabId,
            leafId: pane.leafId,
            persistHostSessionBinding: true,
            launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
            launchToken: LAUNCH_TOKEN,
            envToDelete: [
              'ANTHROPIC_API_KEY',
              'ANTHROPIC_AUTH_TOKEN',
              'CLAUDE_CODE_OAUTH_TOKEN',
              'CLAUDE_CODE_OAUTH_ACCESS_TOKEN',
              'CLAUDE_CODE_OAUTH_REFRESH_TOKEN'
            ],
            env: {
              ORCA_AGENT_LAUNCH_TOKEN: LAUNCH_TOKEN,
              PATH: `${fakeBin}:/usr/bin:/bin`,
              HOME: userHome,
              ASH_FAKE_CLAUDE_PID_FILE: pidFile
            }
          })
          spawnedPtyIds.push(response.id)
          return response
        } finally {
          currentPaneBinding = null
        }
      }

      const foreignSettingsBefore = readFileSync(foreignSettings, 'utf8')
      expect(foreignSettingsBefore).toBe(foreignSettingsBytes)
      expect(canAshWriteProviderGlobalHooks()).toBe(false)

      const responseA = await launch(PANE_A, pidFileA)
      expect(paneSession.terminalLayoutsByTabId[PANE_A.tabId].ptyIdsByLeafId[PANE_A.leafId]).toBe(
        responseA.id
      )
      const nativeA = nativeSpawns[0]
      expect(nativeA).toBeDefined()
      if (!nativeA) {
        throw new Error('runtime controller returned without a native PTY spawn')
      }
      expect(await provider.listProcesses({ ptyIds: [responseA.id] })).toHaveLength(1)
      expect(nativeA.process.pid).toBeGreaterThan(0)
      expect(process.kill(nativeA.process.pid, 0)).toBe(true)
      expect(nativeA.env.CLAUDE_CONFIG_DIR).toBe(profileA.home)
      expect(nativeA.env[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe(profileA.home)
      const pinA = nativeA.env[CLAUDE_PROFILE_POINTER_ENV]
      expect(pinA).toContain(join('claude-profiles', 'session-pins'))
      expect(existsSync(pinA)).toBe(true)
      expect(readFileSync(pinA, 'utf8')).toBe(`${profileA.home}\n`)
      const routeA = `FAKE_CLAUDE_ROUTE|${profileA.home}|${profileA.home}|${profileA.home}`
      await vi.waitFor(() => expect(outputByPty.get(responseA.id) ?? '').toContain(routeA), {
        timeout: 5000
      })
      expect(outputByPty.get(responseA.id)).toContain(routeA)
      const fakePidA = Number(readFileSync(pidFileA, 'utf8').trim())
      expect(Number.isInteger(fakePidA)).toBe(true)
      expect(process.kill(fakePidA, 0)).toBe(true)

      selectedAccountId = ACCOUNT_B
      writeFileSync(selectedPointer, `${profileB.home}\n`, { mode: 0o600 })
      expect(process.kill(nativeA.process.pid, 0)).toBe(true)
      expect(process.kill(fakePidA, 0)).toBe(true)
      expect(existsSync(pinA)).toBe(true)
      expect(readFileSync(pinA, 'utf8')).toBe(`${profileA.home}\n`)

      const responseB = await launch(PANE_B, pidFileB)
      expect(paneSession.terminalLayoutsByTabId[PANE_B.tabId].ptyIdsByLeafId[PANE_B.leafId]).toBe(
        responseB.id
      )
      const nativeB = nativeSpawns[1]
      expect(nativeB).toBeDefined()
      if (!nativeB) {
        throw new Error('second runtime launch returned without a native PTY spawn')
      }
      expect(nativeB.process.pid).toBeGreaterThan(0)
      expect(process.kill(nativeB.process.pid, 0)).toBe(true)
      expect(nativeB.env.CLAUDE_CONFIG_DIR).toBe(profileB.home)
      expect(nativeB.env[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe(profileB.home)
      const pinB = nativeB.env[CLAUDE_PROFILE_POINTER_ENV]
      expect(pinB).toContain(join('claude-profiles', 'session-pins'))
      expect(pinB).not.toBe(pinA)
      expect(existsSync(pinB)).toBe(true)
      expect(readFileSync(pinB, 'utf8')).toBe(`${profileB.home}\n`)
      const routeB = `FAKE_CLAUDE_ROUTE|${profileB.home}|${profileB.home}|${profileB.home}`
      await vi.waitFor(() => expect(outputByPty.get(responseB.id) ?? '').toContain(routeB), {
        timeout: 5000
      })
      expect(outputByPty.get(responseB.id)).toContain(routeB)
      const fakePidB = Number(readFileSync(pidFileB, 'utf8').trim())
      expect(Number.isInteger(fakePidB)).toBe(true)
      expect(process.kill(fakePidB, 0)).toBe(true)
      expect(process.kill(nativeA.process.pid, 0)).toBe(true)
      expect(process.kill(fakePidA, 0)).toBe(true)

      // The host captures A before auth preparation. Replacing A's verified marker
      // during that async boundary must refuse before LocalPtyProvider/node-pty dispatch.
      selectedAccountId = ACCOUNT_A
      writeFileSync(selectedPointer, `${profileA.home}\n`, { mode: 0o600 })
      replaceMarkerOnNextAuth = true
      const nativeSpawnCountBeforeRefusal = nativeSpawns.length
      const pinPathsBeforeRefusal = readFileSync(pinA, 'utf8') + readFileSync(pinB, 'utf8')
      await expect(launch(PANE_REFUSED, pidFileRefused)).rejects.toThrow(
        'claude_session_profile_routing_pin_unavailable'
      )
      expect(nativeSpawns).toHaveLength(nativeSpawnCountBeforeRefusal)
      expect(existsSync(pidFileRefused)).toBe(false)
      expect(existsSync(pinA)).toBe(true)
      expect(existsSync(pinB)).toBe(true)
      expect(readFileSync(pinA, 'utf8') + readFileSync(pinB, 'utf8')).toBe(pinPathsBeforeRefusal)
      expect(readFileSync(foreignSettings, 'utf8')).toBe(foreignSettingsBytes)
      expect(canAshWriteProviderGlobalHooks()).toBe(false)

      await provider.shutdown(responseA.id, { immediate: true })
      expect(exitedPtyIds.has(responseA.id)).toBe(true)
      expect(existsSync(pinA)).toBe(false)
      expect(existsSync(pinB)).toBe(true)
      await provider.shutdown(responseB.id, { immediate: true })
      expect(exitedPtyIds.has(responseB.id)).toBe(true)
      expect(existsSync(pinB)).toBe(false)
      expect(readFileSync(foreignSettings, 'utf8')).toBe(foreignSettingsBytes)
    }, 30_000)
  }
)
