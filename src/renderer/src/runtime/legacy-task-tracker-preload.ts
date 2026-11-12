import type { JiraApi } from '../../../preload/api/jira-api'
import type { LinearApi } from '../../../preload/api/linear-api'

// Archived task-tracker renderer modules still have typed local call sites.
// The product excludes these connectors: never recreate an IPC channel or
// expose a fake success response for a legacy call that reaches this boundary.
export function requireLegacyJiraApi(): JiraApi {
  throw new Error('The Jira application connector is excluded from Ash IDE')
}

export function requireLegacyLinearApi(): LinearApi {
  throw new Error('The Linear application connector is excluded from Ash IDE')
}
