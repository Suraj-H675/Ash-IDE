import { requireLegacyJiraApi } from './legacy-task-tracker-preload'
import type {
  JiraConnectionStatus,
  JiraProject,
  JiraSiteSelection
} from '../../../shared/jira/jira-types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { ASH_TASK_TRACKER_STATUS_ENABLED } from './ash-task-tracker-exclusion'
import { callRuntimeRpc } from './runtime-rpc-client'
import { parseJiraConnectionStatus } from './runtime-jira-connection-status'

export async function jiraStatusForTarget(
  target: RuntimeClientTarget
): Promise<JiraConnectionStatus> {
  if (!ASH_TASK_TRACKER_STATUS_ENABLED) {
    return { connected: false, viewer: null }
  }
  return parseJiraConnectionStatus(
    target.kind === 'environment'
      ? await callRuntimeRpc<unknown>(target, 'jira.status', undefined, { timeoutMs: 15_000 })
      : await requireLegacyJiraApi().status()
  )
}

export async function jiraListProjectsForTarget(
  target: RuntimeClientTarget,
  siteId?: JiraSiteSelection | null
): Promise<JiraProject[]> {
  return target.kind === 'environment'
    ? callRuntimeRpc<JiraProject[]>(target, 'jira.listProjects', siteId ? { siteId } : undefined, {
        timeoutMs: 30_000
      })
    : requireLegacyJiraApi().listProjects(siteId ? { siteId } : undefined)
}
