import type { BundledSkillPlan } from '../../../shared/bundled-skill-plan'
import type { SettingsNavInstallStatus } from './settings-navigation-types'
import { getSkillFreshnessDisplayStatus } from './skill-freshness-display-status'

type AgentSkillNavInstallStatusInput = {
  name: string
  installed: boolean
  loading: boolean
  plan: BundledSkillPlan | null
}

export function getAgentSkillNavInstallStatus({
  name,
  installed,
  loading,
  plan
}: AgentSkillNavInstallStatusInput): SettingsNavInstallStatus {
  if (loading) {
    return 'checking'
  }
  if (!installed) {
    return 'install'
  }
  return getSkillFreshnessDisplayStatus(plan, name)
}
