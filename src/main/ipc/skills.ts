import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  SkillDiscoveryTargetSchema,
  type SkillDiscoveryResult,
  type SkillDiscoveryTarget
} from '../../shared/skills'
import {
  discoverSkillsOnTarget,
  resolveSkillDiscoveryTarget
} from '../skills/skill-discovery-target'
import { unavailableWhileWslDistroStopped } from '../skills/skill-discovery-stopped-wsl-roots'
import { handleMainWindowSkillIpc } from './skill-ipc-main-window'

function createDiscoverResolved(store: Store, runtime?: OrcaRuntimeService) {
  return async (
    resolvedTarget: Awaited<ReturnType<typeof resolveSkillDiscoveryTarget>>,
    refresh: boolean
  ): Promise<SkillDiscoveryResult> =>
    discoverSkillsOnTarget(resolvedTarget, store.getRepos(), {
      providerRootOverrides: await runtime?.resolveSkillDiscoveryProviderRoots(resolvedTarget),
      refresh
    })
}

export function registerProviderNativeSkillDiscoveryHandler(
  store: Store,
  runtime?: OrcaRuntimeService
): void {
  const discoverResolved = createDiscoverResolved(store, runtime)
  // Passive UI mounts discovery, so it must not start a stopped WSL distro.
  const discover = async (target?: SkillDiscoveryTarget): Promise<SkillDiscoveryResult> => {
    const parsedTarget = target ? SkillDiscoveryTargetSchema.parse(target) : undefined
    return unavailableWhileWslDistroStopped(
      async () =>
        discoverResolved(
          await resolveSkillDiscoveryTarget(parsedTarget, { refuseStoppedWslDistro: true }),
          parsedTarget?.refresh === true
        ),
      parsedTarget?.sourceKinds
    )
  }
  handleMainWindowSkillIpc(
    'skills:discover',
    async (_event, target?: SkillDiscoveryTarget): Promise<SkillDiscoveryResult> => discover(target)
  )
}
