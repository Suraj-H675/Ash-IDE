import type { TaskPageResumeRestorationModel } from './use-task-page-resume-restoration'
import { useState } from 'react'
import type { LinearTeam } from '../../../../shared/linear/workspace-types'
import type { JiraProject } from '../../../../shared/jira/jira-types'
export function useTaskPageProviderMetadata(model: TaskPageResumeRestorationModel) {
  // Historical provider state remains typed until the remaining retired Tasks
  // stages are removed. No Jira or Linear metadata is fetched in Ash IDE,
  // including when a saved legacy task source reaches this hook.
  const [availableTeams, setAvailableTeams] = useState<LinearTeam[]>([])
  const [linearTeamRefreshNonce, setLinearTeamRefreshNonce] = useState(0)
  const [availableJiraProjects, setAvailableJiraProjects] = useState<JiraProject[]>([])
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false)
  const nextModel = model as typeof model & {
    availableTeams: typeof availableTeams
    setAvailableTeams: typeof setAvailableTeams
    linearTeamRefreshNonce: typeof linearTeamRefreshNonce
    setLinearTeamRefreshNonce: typeof setLinearTeamRefreshNonce
    availableJiraProjects: typeof availableJiraProjects
    setAvailableJiraProjects: typeof setAvailableJiraProjects
    jiraProjectsLoading: typeof jiraProjectsLoading
    setJiraProjectsLoading: typeof setJiraProjectsLoading
  }
  nextModel.availableTeams = availableTeams
  nextModel.setAvailableTeams = setAvailableTeams
  nextModel.linearTeamRefreshNonce = linearTeamRefreshNonce
  nextModel.setLinearTeamRefreshNonce = setLinearTeamRefreshNonce
  nextModel.availableJiraProjects = availableJiraProjects
  nextModel.setAvailableJiraProjects = setAvailableJiraProjects
  nextModel.jiraProjectsLoading = jiraProjectsLoading
  nextModel.setJiraProjectsLoading = setJiraProjectsLoading
  return nextModel
}
export type TaskPageProviderMetadataModel = ReturnType<typeof useTaskPageProviderMetadata>
