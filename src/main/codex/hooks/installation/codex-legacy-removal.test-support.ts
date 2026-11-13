import { isAbsolute, relative, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import type { AgentHookInstallStatus } from '../../../../shared/agent-hook-listener/configuration/agent-hook-types'
import { physicalAshDataPath } from '../../../orcad/orcad-app-paths'
import {
  getOrcaManagedCodexHomePath,
  getOrcaUserDataPath
} from '../../configuration/homes/codex-home-paths'
import { readEveryKnownCodexHookHashes } from '../../trust/hooks/codex-hook-hash-lookup'
import { runExclusivelyForRuntimeAndSystemTrustConfig } from '../../trust/hooks/codex-hook-trust-queue'
import { removeCodexHooksExclusively } from './codex-hook-local-maintenance'
import { CodexHookService } from './codex-hook-service-implementation'

/**
 * Keep the inherited cleanup's detailed regression coverage without allowing
 * the public Ash service to invoke it. This test-only path must never target
 * a real provider home, even if a test is accidentally run with the user's HOME.
 */
export function exerciseLegacyCodexRemovalInDisposableFixture(): Promise<AgentHookInstallStatus> {
  const testBase = physicalAshDataPath(tmpdir())
  const dataRoot = getOrcaUserDataPath()
  const suffix = relative(testBase, physicalAshDataPath(dataRoot))
  const systemHome = relative(testBase, physicalAshDataPath(homedir()))
  if (
    !suffix ||
    isAbsolute(suffix) ||
    suffix === '..' ||
    suffix.startsWith(`..${sep}`) ||
    !systemHome ||
    isAbsolute(systemHome) ||
    systemHome === '..' ||
    systemHome.startsWith(`..${sep}`)
  ) {
    throw new Error('legacy_codex_removal_test_requires_disposable_data_root')
  }
  const home = getOrcaManagedCodexHomePath()
  return runExclusivelyForRuntimeAndSystemTrustConfig(home, () =>
    removeCodexHooksExclusively(readEveryKnownCodexHookHashes(), () =>
      new CodexHookService().getStatus()
    )
  )
}
