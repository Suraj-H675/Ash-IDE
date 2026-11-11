import { app, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { AgentBrowserBridge } from '../browser/agent-browser/agent-browser-bridge'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { DESKTOP_RPC_CALLER, LOCAL_CLI_RPC_CALLER } from '../runtime/rpc/rpc-caller-identity'
import { browserManager } from '../browser/browser-manager'
import { configureBrowserClientPageAutomationRuntime } from '../browser/client-pages/execution/browser-client-page-automation-runtime'
import { BrowserExpectedUrlMismatch } from '../../shared/browser/client-hosting/browser-expected-url'
import { BrowserClientPageCommandError } from '../browser/client-pages/execution/browser-client-page-command-failure'
import { startPreGoneCrashSampling } from '../crash-reporting/process-gone-diagnostics'
import { refuseRealtimeSchedulingUnderZeroRtTime } from './linux-realtime-scheduling-guard'
import { recordProcessGoneCrash } from './main-window-lifecycle-flags'
import { handleGpuChildCrash } from './gpu-lifecycle'
import { isGpuFallbackCrashCandidate } from '../crash-reporting/gpu-crash-fallback-decision'
import { mainProcessState as state } from './main-process-state'
import { initializeMainProcessObservers } from './main-process-observers'
import { installFirstWorkRenameHookSubscription } from './branch-rename-hook'
import { initializeMainProcessAccountServices } from './main-process-account-services'
import {
  initializeMainProcessRuntime,
  configureRuntimeServices
} from './main-process-runtime-service'
import {
  collectWorktreeTrashSweepRoots,
  sweepStaleWorktreeTrash
} from '../workspaces/removal/worktree-trash'
import { loadWorktreeRemovalRecordsForStore } from './worktree-removal-records-load'
import { runAfterFirstWindowShown } from './first-window-deferral'
import { logStartupMilestone } from './startup-diagnostics'
import { refreshInstalledOpenCodeStatusPlugins } from '../opencode/opencode-status-plugin-startup-refresh'
import { runGatedWslMoveDesktopRewritePass } from '../persistence/moving-wsl-projects/wsl-move-desktop-rewrite'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { repairDuplicatePtyPanesOnStart } from '../runtime/moved-pane-owner-rekey'
import { registerGitHubPRRefreshHandlers } from '../ipc/source-control/github-pr-refresh-handlers'
import { registerRateLimitHandlers } from '../ipc/rate-limits'
import { registerProviderNativeSkillDiscoveryHandler } from '../ipc/skills'
import { registerSkillDeleteIpcHandlers } from '../ipc/skill-delete/handlers'
import { registerAshUpdaterReadOnlyHandlers } from '../ipc/ash-updater-status'

// Headless serve has no first window; timer fallback must still sweep trash.
const WORKTREE_TRASH_SWEEP_FALLBACK_MS = 15_000

export async function initializeReadyRuntimeServices(): Promise<void> {
  const store = state.store
  if (!store) {
    throw new Error('Store must be initialized before ready services')
  }
  // Renderers fork from zygotes that exist already, so this must land before the first window.
  await refuseRealtimeSchedulingUnderZeroRtTime()
  // Load interrupted deletion records before listings so first paint shows Deleting.
  await loadWorktreeRemovalRecordsForStore(store)
  initializeMainProcessObservers()
  const stats = state.stats
  if (!stats) {
    throw new Error('Stats collector must be initialized before GitHub PR refresh handlers')
  }
  registerGitHubPRRefreshHandlers(store, stats)
  initializeMainProcessAccountServices()
  if (!state.rateLimits || !state.codexAccounts) {
    throw new Error('Rate limit services must be initialized before ready handlers')
  }
  registerRateLimitHandlers(state.rateLimits, state.codexAccounts)
  const runtime = initializeMainProcessRuntime()
  configureRuntimeServices(runtime)
  registerProviderNativeSkillDiscoveryHandler(store, runtime)
  // The desktop Skills page uses the trusted-window preload bridge for local
  // preview/delete. Runtime RPC alone only serves remote/paired targets.
  registerSkillDeleteIpcHandlers(store, runtime)
  registerAshUpdaterReadOnlyHandlers()
  installFirstWorkRenameHookSubscription()
  state.agentBrowserBridge = new AgentBrowserBridge(browserManager)
  runtime.setAgentBrowserBridge(state.agentBrowserBridge)
  // Reclaim browser daemons orphaned by prior crashes/SIGKILL.
  void state.agentBrowserBridge.sweepOrphanedSessions()
  const browserClientAutomationDispatcher = new RpcDispatcher({ runtime })
  configureBrowserClientPageAutomationRuntime({
    browserManager,
    getAgentBrowserBridge: () => state.agentBrowserBridge,
    executeRpc: async (method, params, agent, signal) => {
      const response = await browserClientAutomationDispatcher.dispatch(
        { id: randomUUID(), authToken: 'local-browser-client-automation', method, params },
        // Why: the cursor, glow and tab badge key off an agent caller; relayed people are not one.
        { signal, caller: agent ? LOCAL_CLI_RPC_CALLER : DESKTOP_RPC_CALLER }
      )
      if (!response.ok) {
        const mismatch = BrowserExpectedUrlMismatch.safeParse(response.error.data)
        throw new BrowserClientPageCommandError(response.error.code, {
          expectedUrlMismatch: mismatch.success ? mismatch.data : undefined
        })
      }
      return response.result
    }
  })
  // Finish recorded deletes and old trash left across crashes; defer disk sweeps so they do not compete with first paint/catalog hydration.
  runAfterFirstWindowShown(() => {
    void sweepStaleWorktreeTrash(
      collectWorktreeTrashSweepRoots(store.getRepos(), store.getSettings())
    ).catch((error) => {
      console.warn('[worktrees] Failed to sweep leftover worktree directories:', error)
    })
    runtime.finishInterruptedWorktreeRemovals()
  }, WORKTREE_TRASH_SWEEP_FALLBACK_MS)
  // Defer noncritical plugin-file refresh past first paint.
  runAfterFirstWindowShown(() => {
    refreshInstalledOpenCodeStatusPlugins(store.getSettings())
  }, WORKTREE_TRASH_SWEEP_FALLBACK_MS)
  // The startup pass ran before browser sessions and any window existed, so `browser-cookies` paused.
  runAfterFirstWindowShown(() => {
    void runGatedWslMoveDesktopRewritePass({ userDataPath: app.getPath('userData') })
  }, WORKTREE_TRASH_SWEEP_FALLBACK_MS)
  nativeTheme.themeSource = store.getSettings().theme ?? 'system'
  // Sample live processes: gone-time metrics omit dead children and already-released memory.
  startPreGoneCrashSampling()
  app.on('child-process-gone', (_event, details) => {
    recordProcessGoneCrash('child', details.type, details.reason, details.exitCode ?? null, {
      name: details.name,
      serviceName: details.serviceName,
      type: details.type
    })
    if (
      isGpuFallbackCrashCandidate({
        platform: process.platform,
        processType: details.type,
        reason: details.reason
      })
    ) {
      const crashedAt = performance.now()
      void state.gpuCrashDiagnostics?.record()
      void handleGpuChildCrash(details.reason, details.exitCode ?? null, crashedAt)
    }
  })
  // Await duplicate-pane repair behind queued writes; all later phases must read the repaired tree.
  if (ORCA_LAYOUT_OWNER_IS_MAIN) {
    await repairDuplicatePtyPanesOnStart(store, runtime)
  }
  logStartupMilestone('services-initialized')
}
