import { app } from 'electron'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import { registerAppHandlers } from '../app'
import { installProjectRuntimeGitRouter } from '../../workspaces/execution-host/project-runtime-git-router'
import { registerCliHandlers } from '../cli'
import { registerPreflightHandlers } from '../preflight'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { StatsCollector } from '../../stats/collector'
import { registerFilesystemHandlers } from '../filesystem/filesystem'
import type { CommitMessageAgentEnvironmentResolvers } from '../../text-generation/commit-message-agent-environment'
import { registerFilesystemWatcherHandlers } from '../filesystem/watchers/filesystem-watcher-handlers'
import { registerUsageProviderHandlers } from '../usage-provider-handlers'
import { registerCrashReportingHandlers } from '../crash-reporting/crash-reporting'
import { registerExportHandlers } from '../export'
import { registerStatsHandlers } from '../stats'
import { registerMemoryHandlers } from '../memory'
import { registerRuntimeHandlers } from '../runtime'
import { registerAshLocalEnvironmentQueries } from '../runtime-environments/ash-local-environment-queries'
import { registerEphemeralVmHandlers } from '../ephemeral-vm'
import { registerAiVaultHandlers } from '../ai-vault/ai-vault'
import { registerAiVaultSearchHandlers } from '../ai-vault/ai-vault-search'
import { registerNativeChatHandlers } from '../native-chat'
import { registerNotificationHandlers } from '../notifications'
import { registerNotebookHandlers } from '../notebook'
import { registerOnboardingHandlers } from '../onboarding'
import { registerDashboardPopoutHandlers } from '../dashboard-popout'
import { registerWorkspaceSpaceWindowHandlers } from '../workspace-space/workspace-space-window'
import { registerTerminalPreviewHandlers } from '../terminal-preview'
import { registerDeveloperPermissionHandlers } from '../developer-permissions'
import { registerComputerUsePermissionHandlers } from '../computer-use-permissions'
import { setAgentBrowserBridgeRef, registerBrowserHandlers } from '../browser/browser'
import { setTrustedBrowserRendererWebContentsId } from '../browser/browser-renderer-trust'
import { registerSessionHandlers } from '../session'
import { registerSettingsHandlers } from '../settings'
import { registerDiagnosticsHandlers } from '../diagnostics'
import { registerWorkspaceSpaceHandlers } from '../workspace-space/workspace-space'
import { registerWorkspacePortHandlers } from '../workspace-ports'
import { registerLinkPreviewHandlers } from '../link-preview'
import { registerLocalhostWorktreeLabelHandlers } from '../localhost-worktree-labels'
import { registerKeybindingHandlers } from '../keybindings'
import { registerShellHandlers } from '../shell'
import { registerPetHandlers } from '../pets/pet'
import { registerUIHandlers, setTrustedUIRendererWebContentsId } from '../ui'
import { registerTerminalRenderDesyncEvidenceHandler } from '../terminal-render-desync-evidence'
import { registerAgentHookHandlers } from '../agent-hooks'
import { getPtyIdForPaneKey } from '../pty/pane/key-state'
import {
  registerClipboardHandlers,
  setTrustedClipboardRendererWebContentsId
} from '../../window/clipboard-ipc-handlers'
import { isDashboardPopoutRenderer } from '../../window/dashboard-popout-window'
import type { ClaudeUsageStore } from '../../claude-usage/store'
import type { CodexUsageStore } from '../../codex-usage/store'
import type { OpenCodeUsageStore } from '../../opencode-usage/store'
import type { MuseUsageStore } from '../../muse-usage/store'
import type { AgentAwakeService } from '../../power/agent-awake-service'
import type { CrashReportStore } from '../../crash-reporting/crash-report-store'
import type { KeybindingService } from '../../keybindings/keybinding-service'
import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import {
  getSavedRuntimeAiVaultHostInfos,
  deleteRuntimeAiVaultSession,
  prepareRuntimeAiVaultSessionResume,
  resolveRuntimeAiVaultSessionTitles,
  scanRuntimeAiVaultSessions
} from '../../ai-vault/runtime-session-scanner'
import { callRuntimeSessionSearch } from '../../ai-vault/runtime-session-search-call'
import { configureRuntimeAiVaultSessionDelete } from '../ai-vault/ai-vault-delete'
import { ensureStructuredAgentSessionHostUnlessRefused } from '../../runtime/agent-session/structured-agent-session-host-refusal'
import { getAgentSessionAttachmentStore } from '../../native-chat/agent-session-attachments/agent-session-attachment-store-registry'
import { settleWithinMs } from '../../startup/quit/quit-teardown-deadline'
import { getRuntimeEnvironmentRegistryRoot } from '../runtime-environments/runtime-environment-registry-root'

let registered = false
// Same cap as the restart path's auth preservation: bookkeeping must not hold Restart on a stalled disk.
const RELAUNCH_DISMISSAL_CLOSE_TIMEOUT_MS = 2_000

async function closeNotificationDismissalsBeforeRelaunch(
  runtime: OrcaRuntimeService
): Promise<void> {
  const result = await settleWithinMs(
    runtime.closeNotificationDismissals(),
    RELAUNCH_DISMISSAL_CLOSE_TIMEOUT_MS
  )
  if (result.outcome === 'timed-out') {
    console.warn('[notifications] Relaunching before dismissal recovery state finished saving')
  }
}

type CoreHandlerLifecycleOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  getAdditionalAiVaultCodexHomePaths?: () => readonly string[]
  prepareAiVaultSessionResume?: (
    args: AiVaultPrepareSessionResumeArgs
  ) => Promise<AiVaultPrepareSessionResumeResult>
}

export function registerCoreHandlers(
  store: Store,
  runtime: OrcaRuntimeService,
  stats: StatsCollector,
  claudeUsage: ClaudeUsageStore,
  codexUsage: CodexUsageStore,
  openCodeUsage: OpenCodeUsageStore,
  museUsage: MuseUsageStore,
  mainWindowWebContentsId: number | null = null,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers,
  agentAwakeService?: AgentAwakeService,
  crashReports?: CrashReportStore,
  keybindings?: KeybindingService,
  lifecycleOptions: CoreHandlerLifecycleOptions = {}
): void {
  // macOS activation can replace the window without ending the app; refresh trusted IDs but register IPC once.
  setTrustedBrowserRendererWebContentsId(mainWindowWebContentsId)
  setTrustedClipboardRendererWebContentsId(mainWindowWebContentsId)
  setTrustedUIRendererWebContentsId(mainWindowWebContentsId)
  setAgentBrowserBridgeRef(runtime.getAgentBrowserBridge())
  if (registered) {
    return
  }
  registered = true

  registerAppHandlers(store, {
    quitResumeRecordsFor: (session) => runtime.quitResumeRecordsFor(session),
    ...(ORCA_LAYOUT_OWNER_IS_MAIN
      ? {
          reconnectFactsFor: (session, partition) =>
            runtime.shutdownReconnectFactsFor(session, partition)
        }
      : {}),
    onBeforeRelaunch: lifecycleOptions.onBeforeRelaunch,
    // Restart/profile switching closes this through will-quit; this callback covers relaunch exit.
    onBeforeRelaunchExit: () => closeNotificationDismissalsBeforeRelaunch(runtime)
  })
  registerCliHandlers()
  registerPreflightHandlers(store)
  registerUsageProviderHandlers({ claudeUsage, codexUsage, openCodeUsage, museUsage })
  registerAgentHookHandlers(runtime, { getPtyIdForPaneKey })
  if (crashReports) {
    registerCrashReportingHandlers(crashReports)
  }
  registerExportHandlers()
  registerStatsHandlers(stats)
  registerMemoryHandlers(store)
  registerNotificationHandlers(store, runtime)
  registerNotebookHandlers(store)
  registerOnboardingHandlers(store)
  registerDashboardPopoutHandlers(store, keybindings)
  registerWorkspaceSpaceWindowHandlers(store)
  registerTerminalPreviewHandlers(runtime)
  registerDeveloperPermissionHandlers()
  // Diagnostics and telemetry register independent channels and keep separate data paths.
  registerDiagnosticsHandlers()
  registerTerminalRenderDesyncEvidenceHandler()
  registerComputerUsePermissionHandlers()
  registerSettingsHandlers(store, agentAwakeService)
  if (keybindings) {
    registerKeybindingHandlers(keybindings)
  }
  registerBrowserHandlers(store)
  registerShellHandlers(store)
  registerPetHandlers()
  registerSessionHandlers(store, runtime)
  registerUIHandlers(store, { isDashboardPopoutRenderer })
  registerWorkspaceSpaceHandlers(store)
  registerWorkspacePortHandlers(store)
  registerLinkPreviewHandlers()
  registerLocalhostWorktreeLabelHandlers(store)
  registerFilesystemHandlers(store, commitMessageAgentEnv)
  registerFilesystemWatcherHandlers()
  registerRuntimeHandlers(runtime)
  // Ash has no paired runtimes, remote SSH hosts, or WSL remote development.
  // Keep only the empty, read-only catalog queried by retained local views.
  registerAshLocalEnvironmentQueries()
  installProjectRuntimeGitRouter(store)
  registerEphemeralVmHandlers(store)
  // Session history and terminal resume are not chats; a refused host leaves nothing to check.
  const ensureStructuredSessionOwnership = () =>
    ensureStructuredAgentSessionHostUnlessRefused(() => runtime.ensureStructuredAgentSessionHost())
  registerAiVaultSearchHandlers({
    callRuntimeSearch: (environmentId, method, params) =>
      callRuntimeSessionSearch(getRuntimeEnvironmentRegistryRoot(), environmentId, method, params),
    ensureStructuredSessionOwnership
  })
  registerAiVaultHandlers({
    getUserDataPath: () => app.getPath('userData'),
    ensureStructuredSessionOwnership,
    getAdditionalCodexHomePaths: lifecycleOptions.getAdditionalAiVaultCodexHomePaths,
    prepareSessionResume: lifecycleOptions.prepareAiVaultSessionResume,
    getActiveRuntimeAiVaultHostInfos: () =>
      getSavedRuntimeAiVaultHostInfos(getRuntimeEnvironmentRegistryRoot()),
    scanRuntimeAiVaultSessions: async (environmentId, args, options) =>
      scanRuntimeAiVaultSessions(getRuntimeEnvironmentRegistryRoot(), environmentId, args, options),
    resolveRuntimeAiVaultSessionTitles: async (environmentId, args) =>
      resolveRuntimeAiVaultSessionTitles(getRuntimeEnvironmentRegistryRoot(), environmentId, args),
    prepareRuntimeSessionResume: async (environmentId, args) =>
      prepareRuntimeAiVaultSessionResume(getRuntimeEnvironmentRegistryRoot(), environmentId, args)
  })
  configureRuntimeAiVaultSessionDelete((environmentId, args) =>
    deleteRuntimeAiVaultSession(getRuntimeEnvironmentRegistryRoot(), environmentId, args)
  )
  registerNativeChatHandlers()
  registerClipboardHandlers(store, {
    localChatAttachmentStore: async () => {
      await ensureStructuredAgentSessionHostUnlessRefused(() =>
        runtime.ensureStructuredAgentSessionHost()
      )
      return getAgentSessionAttachmentStore()
    }
  })
}
