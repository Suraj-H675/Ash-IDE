// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _skillFreshnessCacheForTests, useSkillFreshness } from '../hooks/useSkillFreshness'
import { runWslDriveUncRendererStoreRewrites } from '../lib/wsl-drive-unc-renderer-store-rewrites'
import { runWslMoveRendererStoreRewrites } from '../lib/wsl-move-renderer-store-rewrites'
import { jiraStatusForTarget } from '../runtime/runtime-jira-project-client'
import { linearStatusForTarget } from '../runtime/runtime-linear-client'
import { sanitizeHydratedActiveView } from '../store/slices/ui/ui-slice-hydration-sanitizers'
import { getGeneralPaneSearchEntries } from '../components/settings/general/general-search'
import {
  resetStartupActionsSelectorCacheForTest,
  selectStartupActions,
  type StartupActions
} from './startup-actions-selector'

describe('Ash excluded desktop startup capabilities', () => {
  let priorApi: PropertyDescriptor | undefined
  let platform: NodeJS.Platform
  let root: Root | null
  let host: HTMLDivElement | null

  const bundledPlan = vi.fn(async () => {
    throw new Error('skills:bundledPlan should never run on local Ash')
  })
  const listPendingWslRewrites = vi.fn(async () => [])
  const listPendingDriveUncRewrites = vi.fn(async () => [])
  const jiraStatus = vi.fn(() => {
    throw new Error('jira.status should be excluded on Ash')
  })
  const linearStatus = vi.fn(() => {
    throw new Error('linear.status should be excluded on Ash')
  })
  const runtimeEnvironmentCall = vi.fn(() => {
    throw new Error('runtime status RPC should be excluded on Ash')
  })

  it('does not subscribe startup hydration to excluded remote SSH host actions', () => {
    resetStartupActionsSelectorCacheForTest()
    const startupKeys = [
      'fetchReposForAllHosts',
      'awaitLocalRepoCatalogSettlement',
      'fetchProjectGroupsForAllHosts',
      'fetchFolderWorkspacesForAllHosts',
      'fetchAllWorktrees',
      'fetchWorktrees',
      'fetchWorktreeLineage',
      'fetchSettings',
      'awaitOwnerWorktreeVisibilityDefaultsHydration',
      'fetchKeybindings',
      'initGitHubCache',
      'hydrateWorkspaceSession',
      'hydrateTabsSession',
      'hydrateEditorSession',
      'hydrateBrowserSession',
      'fetchBrowserSessionProfiles',
      'reconnectPersistedTerminals',
      'setTerminalStartupRestorationReady',
      'hydratePersistedUI',
      'setHydrationSucceeded',
      'pruneLastVisitedTimestamps',
      'seedActiveWorktreeLastVisitedIfMissing'
    ] as const
    const actions = Object.fromEntries(
      startupKeys.map((key) => [key, vi.fn()])
    ) as unknown as StartupActions
    const first = selectStartupActions(actions)
    expect(Object.keys(first).sort()).toEqual([...startupKeys].sort())
    const withChangedRemoteSshState = {
      ...actions,
      setSshConnectionState: vi.fn(),
      setDeferredSshReconnectTargets: vi.fn(),
      removeDeferredSshReconnectTarget: vi.fn()
    }
    expect(selectStartupActions(withChangedRemoteSshState)).toBe(first)
    resetStartupActionsSelectorCacheForTest()
  })

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    priorApi = Object.getOwnPropertyDescriptor(window, 'api')
    platform = 'linux'
    root = null
    host = null
    bundledPlan.mockClear()
    listPendingWslRewrites.mockClear()
    listPendingDriveUncRewrites.mockClear()
    jiraStatus.mockClear()
    linearStatus.mockClear()
    runtimeEnvironmentCall.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        platform: { get: () => ({ platform }) },
        skills: { bundledPlan },
        jira: { status: jiraStatus },
        linear: { status: linearStatus },
        runtimeEnvironments: { call: runtimeEnvironmentCall },
        wslMove: { listPendingRendererRewrites: listPendingWslRewrites },
        wslDriveUnc: { listPendingRendererRewrites: listPendingDriveUncRewrites }
      }
    })
    _skillFreshnessCacheForTests.reset()
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    host?.remove()
    _skillFreshnessCacheForTests.reset()
    if (priorApi) {
      Object.defineProperty(window, 'api', priorApi)
    } else {
      Reflect.deleteProperty(window, 'api')
    }
    vi.unstubAllGlobals()
  })

  it.each(['linux', 'darwin', 'win32'] as const)(
    'does not request excluded bundled-skill planning on local %s',
    async (hostPlatform) => {
      platform = hostPlatform
      let latest: ReturnType<typeof useSkillFreshness> | null = null
      const HookProbe = () => {
        latest = useSkillFreshness({ kind: 'local' })
        return null
      }
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
      await act(async () => root?.render(<HookProbe />))
      expect(bundledPlan).not.toHaveBeenCalled()
      expect(latest).toMatchObject({ loading: false, plan: null, unsupported: null, error: null })
    }
  )

  it('does not invoke WSL-move IPC on Linux/macOS, but retains Windows recovery', async () => {
    await runWslMoveRendererStoreRewrites()
    platform = 'darwin'
    await runWslMoveRendererStoreRewrites()
    expect(listPendingWslRewrites).not.toHaveBeenCalled()

    platform = 'win32'
    await runWslMoveRendererStoreRewrites()
    expect(listPendingWslRewrites).toHaveBeenCalledTimes(1)
  })

  it('does not invoke WSL drive UNC conversion on Linux/macOS; Windows migration remains intact', async () => {
    await runWslDriveUncRendererStoreRewrites()
    platform = 'darwin'
    await runWslDriveUncRendererStoreRewrites()
    expect(listPendingDriveUncRewrites).not.toHaveBeenCalled()

    platform = 'win32'
    await runWslDriveUncRendererStoreRewrites()
    expect(listPendingDriveUncRewrites).toHaveBeenCalledTimes(1)
  })

  it('returns disconnected Jira and Linear status without local IPC or remote runtime RPC', async () => {
    const localTarget = { kind: 'local' } as const
    const remoteTarget = { kind: 'environment', environmentId: 'remote-test' } as const

    await expect(jiraStatusForTarget(localTarget)).resolves.toMatchObject({
      connected: false,
      viewer: null
    })
    await expect(linearStatusForTarget(localTarget)).resolves.toMatchObject({
      connected: false,
      viewer: null
    })
    await expect(jiraStatusForTarget(remoteTarget)).resolves.toMatchObject({
      connected: false,
      viewer: null
    })
    await expect(linearStatusForTarget(remoteTarget)).resolves.toMatchObject({
      connected: false,
      viewer: null
    })

    expect(jiraStatus).not.toHaveBeenCalled()
    expect(linearStatus).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('does not restore removed mobile or bundled-skills pages as the active view', () => {
    expect(sanitizeHydratedActiveView('mobile')).toBe('terminal')
    expect(sanitizeHydratedActiveView('skills')).toBe('terminal')
    expect(sanitizeHydratedActiveView('automations')).toBe('terminal')
    expect(sanitizeHydratedActiveView('settings')).toBe('settings')
    expect(sanitizeHydratedActiveView('terminal')).toBe('terminal')
  })

  it('does not advertise the inherited Orca GitHub-star promotion in settings search', () => {
    const entries = getGeneralPaneSearchEntries()
    expect(
      entries.some((entry) =>
        /star orca|support the project with a github star/i.test(
          [entry.title, entry.description, ...(entry.keywords ?? [])].join(' ')
        )
      )
    ).toBe(false)
    expect(entries.length).toBeGreaterThan(0)
  })
})
