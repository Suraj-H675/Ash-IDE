import type { CodexHomeLaunchContext } from '../../../ipc/pty/host-env/types'
import type { CodexAccountSelectionTarget } from '../../../../shared/codex-selection-lane'
import type { CodexRuntimeHomeService } from '../../../codex-accounts/runtime-home-service'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

export function createCodexRuntimeHomeLaunchPreparation(_deps: {
  getRuntimeHome: () => Pick<CodexRuntimeHomeService, 'prepareForCodexLaunchAsync'> | null
  getSettings: () => GlobalSettings | undefined
}) {
  return async (
    _target?: CodexAccountSelectionTarget,
    _launchEnv?: NodeJS.ProcessEnv,
    _launchContext?: CodexHomeLaunchContext
  ): Promise<string | null> => {
    void _launchContext
    // Null lets Codex use the user's existing CODEX_HOME and auth without copying or syncing it.
    return null
  }
}
