import type { JiraQuickFilterState } from '../../../shared/jira/jira-quick-filters'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'

// Compatibility exports for unmounted legacy Tasks hooks; no provider transport is permitted.
export async function readJiraQuickFilterState(
  _target: RuntimeClientTarget
): Promise<JiraQuickFilterState> {
  throw new Error('Jira integration is excluded from Ash IDE')
}

export async function writeJiraQuickFilterState(
  _target: RuntimeClientTarget,
  _state: JiraQuickFilterState
): Promise<JiraQuickFilterState> {
  throw new Error('Jira integration is excluded from Ash IDE')
}
