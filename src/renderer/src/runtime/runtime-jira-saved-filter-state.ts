import type {
  JiraSavedFilterMutation,
  JiraSavedFilterState
} from '../../../shared/jira/jira-saved-filters'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'

// Compatibility exports for unmounted legacy Tasks hooks; no provider transport is permitted.
export async function readJiraSavedFilterState(
  _target: RuntimeClientTarget
): Promise<JiraSavedFilterState> {
  throw new Error('Jira integration is excluded from Ash IDE')
}

export async function mutateJiraSavedFilters(
  _target: RuntimeClientTarget,
  _mutation: JiraSavedFilterMutation
): Promise<JiraSavedFilterState> {
  throw new Error('Jira integration is excluded from Ash IDE')
}
