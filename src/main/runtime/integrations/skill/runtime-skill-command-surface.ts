import { homedir } from 'node:os'
import { toLinuxPath } from '../../../../shared/wsl-paths'
import type {
  BundledSkillAutoUpdateRequest,
  LocalBundledSkillExecuteRequest,
  BundledSkillInstallResult,
  BundledSkillPlan,
  LocalBundledSkillPlanRequest
} from '../../../../shared/bundled-skill-plan'
import {
  autoUpdateLocalBundledSkills,
  executeLocalBundledSkills,
  planLocalBundledSkills
} from './runtime-bundled-skill-install'
import { resolveSkillProviderRoots } from './runtime-skill-install-authority'
import type { RuntimeSkillCommandHost } from './runtime-skill-command-contract'

/** Ash's live runtime surface exposes only local bundled skills and native provider discovery. */
export class RuntimeSkillCommands {
  constructor(private readonly host: RuntimeSkillCommandHost) {}

  planLocalBundledSkills(request: LocalBundledSkillPlanRequest): Promise<BundledSkillPlan> {
    return planLocalBundledSkills(this.host, request)
  }

  executeLocalBundledSkills(
    request: LocalBundledSkillExecuteRequest
  ): Promise<BundledSkillInstallResult> {
    return executeLocalBundledSkills(this.host, request)
  }

  autoUpdateLocalBundledSkills(
    request: BundledSkillAutoUpdateRequest
  ): Promise<BundledSkillInstallResult> {
    return autoUpdateLocalBundledSkills(this.host, request)
  }

  async resolveSkillDiscoveryProviderRoots(target: {
    kind: 'native-host' | 'wsl'
    distro?: string
  }) {
    const roots = await resolveSkillProviderRoots(this.host, {
      scope: 'global',
      homeDirectory: homedir(),
      ...(target.kind === 'wsl' && target.distro ? { wslDistro: target.distro } : {})
    })
    return target.kind === 'wsl'
      ? Object.fromEntries(
          Object.entries(roots).map(([provider, root]) => [provider, toLinuxPath(root)])
        )
      : roots
  }
}
