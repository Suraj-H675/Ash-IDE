import { defineMethod } from '../core'
import type { z } from 'zod'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { SkillDeleteRequestSchema } from '../../../../shared/skill-delete-contract'
import {
  BundledSkillAutoUpdateRequestSchema,
  BundledSkillExecuteRequestSchema,
  BundledSkillPlanRequestSchema
} from '../../../../shared/bundled-skill-plan'
import {
  previewSkillDeleteRequest,
  runSkillDeleteRequest,
  type SkillDeleteRequestDependencies
} from '../../../skills/skill-delete/request-service'
import type { SkillDiscoveryTargetSchema } from '../../../../shared/skills'
import {
  discoverSkillsOnTarget,
  resolveSkillDiscoveryTarget
} from '../../../skills/skill-discovery-target'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { SkillsDiscoverParams } from '../../../../shared/rpc-contract/skills-params'
import { unavailableWhileWslDistroStopped } from '../../../skills/skill-discovery-stopped-wsl-roots'

// Use the same target resolution for discovery and delete-plan roots, including WSL.
export function resolveDiscoveryTarget(
  params: z.infer<typeof SkillDiscoveryTargetSchema>,
  runtime: Pick<OrcaRuntimeService, 'resolveProjectRuntimeForWorktree'>,
  options: { refuseStoppedWslDistro?: boolean } = {}
) {
  const target = params.projectRuntime
    ? params
    : {
        ...params,
        projectRuntime: runtime.resolveProjectRuntimeForWorktree(params.worktreeId)
      }
  return resolveSkillDiscoveryTarget(target, options)
}

// A caller naming only the workspace gets its folder from the host, which refuses SSH workspaces like desktop.
async function withWorkspaceCwd(
  params: z.infer<typeof SkillsDiscoverParams>,
  runtime: Pick<OrcaRuntimeService, 'resolveRuntimeFileTarget'>
): Promise<z.infer<typeof SkillsDiscoverParams>> {
  if (params.cwd?.trim() || !params.worktreeId) {
    return params
  }
  const target = await runtime.resolveRuntimeFileTarget(`id:${params.worktreeId}`)
  if (parseExecutionHostId(target.executionHostId)?.kind === 'ssh') {
    throw new Error('Skill discovery is unavailable for SSH hosts.')
  }
  return { ...params, cwd: target.worktree.path }
}

function skillDeleteDependencies(
  runtime: Pick<OrcaRuntimeService, 'listRepos' | 'resolveSkillDiscoveryProviderRoots'>
): SkillDeleteRequestDependencies {
  return {
    repos: () => runtime.listRepos(),
    resolveProviderRootOverrides: (target) => runtime.resolveSkillDiscoveryProviderRoots(target),
    userDataPath: getAppEnvironment().getPath('userData')
  }
}

export const SKILL_METHODS = [
  defineMethod({
    name: 'skills.discover',
    permission: 'workspace',
    params: SkillsDiscoverParams,
    handler: async (params, { runtime }) =>
      unavailableWhileWslDistroStopped(async () => {
        // Resolve WSL preferences on the executing host; remote clients provide workspace identity, not trusted runtime absence.
        const resolvedTarget = await resolveDiscoveryTarget(
          await withWorkspaceCwd(params, runtime),
          runtime,
          { refuseStoppedWslDistro: true }
        )
        return discoverSkillsOnTarget(resolvedTarget, runtime.listRepos(), {
          providerRootOverrides: await runtime.resolveSkillDiscoveryProviderRoots(resolvedTarget),
          refresh: params.refresh === true
        })
      }, params.sourceKinds)
  }),
  defineMethod({
    name: 'skills.previewDelete',
    permission: 'workspace',
    params: SkillDeleteRequestSchema,
    handler: async (params, { runtime }) =>
      previewSkillDeleteRequest(
        params,
        await resolveDiscoveryTarget(params.target ?? {}, runtime),
        skillDeleteDependencies(runtime)
      )
  }),
  defineMethod({
    name: 'skills.delete',
    permission: 'skills-admin',
    params: SkillDeleteRequestSchema,
    handler: async (params, { runtime }) =>
      runSkillDeleteRequest(
        params,
        await resolveDiscoveryTarget(params.target ?? {}, runtime),
        skillDeleteDependencies(runtime)
      )
  }),
  // The host plans Orca's skills on its own disk; a paired client never sends a WSL target.
  defineMethod({
    name: 'skills.planBundledOrca',
    permission: 'workspace',
    params: BundledSkillPlanRequestSchema,
    handler: (params, { runtime }) => runtime.planLocalBundledSkills(params)
  }),
  defineMethod({
    name: 'skills.executeBundledOrca',
    permission: 'skills-admin',
    params: BundledSkillExecuteRequestSchema,
    handler: (params, { runtime }) => runtime.executeLocalBundledSkills(params)
  }),
  defineMethod({
    name: 'skills.autoUpdateBundledOrca',
    permission: 'skills-admin',
    params: BundledSkillAutoUpdateRequestSchema,
    handler: (params, { runtime }) => runtime.autoUpdateLocalBundledSkills(params)
  })
]
