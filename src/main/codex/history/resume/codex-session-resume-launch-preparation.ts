import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import type { CodexAccountSelectionTarget } from '../../../../shared/codex-selection-lane'
import {
  trustedCodexResumeHomes,
  type CodexSessionResumePreparation
} from './codex-session-resume-home'
import { prepareCodexSessionResume } from './codex-session-resume-preparation'
import {
  prepareCodexAccountRestartResume,
  prepareLegacySharedCodexSessionResume
} from './codex-legacy-session-resume'
import { ManagedCodexHomeTemporarilyUnavailableError } from '../../../codex-accounts/host-codex-managed-home-ownership'
import {
  getOrcaManagedCodexHomePath,
  getSystemCodexHomePath
} from '../../configuration/homes/codex-home-paths'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import type { CodexRuntimeHomeService } from '../../../codex-accounts/runtime-home-service'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

export function createCodexSessionResumeLaunchPreparation(deps: {
  getRuntimeHome: () => CodexRuntimeHomeService | null
  getSettings: () => GlobalSettings | undefined
}) {
  // Pinned homes bypass selected-account preparation without changing provider-owned files.
  async function prepareCodexPinnedLaunchHome(
    _home: string,
    _systemHomePath: string = getSystemCodexHomePath()
  ): Promise<void> {
    void _home
    void _systemHomePath
  }

  async function prepareCodexSessionResumeForLaunch(args: {
    providerSession: AgentProviderSessionMetadata
    target: CodexAccountSelectionTarget
    launchEnv?: NodeJS.ProcessEnv
    useSelectedAccount?: boolean
  }): Promise<CodexSessionResumePreparation | null> {
    const runtimeHome = deps.getRuntimeHome()
    if (args.target.runtime === 'wsl' || !runtimeHome || !deps.getSettings()) {
      return null
    }
    const systemHomePath = getSystemCodexHomePath()
    const trustedHomes = trustedCodexResumeHomes(runtimeHome, systemHomePath)
    // Refuse unreadable selections before provenance matching can choose another account.
    const selectedAccountCodexHome = runtimeHome.resolveSelectedHostAccountCodexHomePathForResume()
    const preparation = await prepareCodexSessionResume({
      sessionId: args.providerSession.id,
      transcriptPath: args.providerSession.transcriptPath,
      trustedCodexHomes: trustedHomes,
      getSelectedAccountCodexHome: () => selectedAccountCodexHome,
      systemCodexHomePath: systemHomePath,
      sharedRuntimeCodexHomePath: getOrcaManagedCodexHomePath(),
      resolveVerifiedResumeHome: async (sessionSource) => {
        let migrated = { useRealCodexHome: false }
        try {
          migrated = await prepareLegacySharedCodexSessionResume(
            {
              agent: 'codex',
              executionHostId: 'local',
              filePath: sessionSource.transcriptPath,
              codexHome: sessionSource.homePath
            },
            {
              isHostSystemDefaultRealHomeSelected: () =>
                runtimeHome.isHostSystemDefaultRealHomeSelected(),
              systemCodexHomePath: systemHomePath
            }
          )
        } catch (error) {
          // A credential-read refusal must never fall back to the old account.
          if (error instanceof ManagedCodexHomeTemporarilyUnavailableError) {
            throw error
          }
          // Failed migration can still resume from the verified origin home.
          console.warn(
            '[codex-session-resume] Legacy rollout migration failed; using origin home:',
            error
          )
        }
        const resumeHome = args.useSelectedAccount
          ? await prepareCodexAccountRestartResume({
              sourceHome: sessionSource.homePath,
              transcriptPath: sessionSource.transcriptPath,
              targetHome: selectedAccountCodexHome ?? systemHomePath,
              systemCodexHomePath: systemHomePath
            })
          : migrated.useRealCodexHome
            ? systemHomePath
            : sessionSource.homePath
        await prepareCodexPinnedLaunchHome(resumeHome, systemHomePath)
        return resumeHome
      }
    })
    return preparation.outcome === 'resume'
      ? {
          ...preparation,
          reconcileSharedRuntimeAuth:
            normalizeRuntimePathForComparison(preparation.codexHomePath) ===
            normalizeRuntimePathForComparison(getOrcaManagedCodexHomePath())
        }
      : preparation
  }

  return { prepareCodexSessionResumeForLaunch, prepareCodexPinnedLaunchHome }
}
