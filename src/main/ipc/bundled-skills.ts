import {
  BundledSkillAutoUpdateRequestSchema,
  LocalBundledSkillExecuteRequestSchema,
  LocalBundledSkillPlanRequestSchema,
  type BundledSkillInstallResult,
  type BundledSkillPlan
} from '../../shared/bundled-skill-plan'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { handleMainWindowSkillIpc } from './skill-ipc-main-window'

type LocalBundledSkillRuntime = Pick<
  OrcaRuntimeService,
  'planLocalBundledSkills' | 'executeLocalBundledSkills' | 'autoUpdateLocalBundledSkills'
>

/** Ash-only desktop IPC for bundled local skills; vendor Cloud skill installs stay retired. */
export function registerLocalBundledSkillIpcHandlers(runtime: LocalBundledSkillRuntime): void {
  handleMainWindowSkillIpc(
    'skills:bundledPlan',
    async (_event, value?: unknown): Promise<BundledSkillPlan> =>
      runtime.planLocalBundledSkills(LocalBundledSkillPlanRequestSchema.parse(value ?? {}))
  )
  handleMainWindowSkillIpc(
    'skills:bundledExecute',
    async (_event, value: unknown): Promise<BundledSkillInstallResult> =>
      runtime.executeLocalBundledSkills(LocalBundledSkillExecuteRequestSchema.parse(value))
  )
  handleMainWindowSkillIpc(
    'skills:bundledAutoUpdate',
    async (_event, value: unknown): Promise<BundledSkillInstallResult> =>
      runtime.autoUpdateLocalBundledSkills(BundledSkillAutoUpdateRequestSchema.parse(value))
  )
}
