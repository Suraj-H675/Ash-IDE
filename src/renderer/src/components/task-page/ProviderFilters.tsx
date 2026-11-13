import type { TaskPageComposerActionsModel } from './use-task-page-composer-actions'
import { TaskPageGitHubFilters } from './github/Filters'
import { TaskPageGitLabFilters } from './gitlab/Filters'
export function TaskPageProviderFilters({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const { taskSource, githubMode } = model
  return taskSource === 'github' && githubMode === 'items' ? (
    // Join the filter chrome to the table shell below.
    <TaskPageGitHubFilters model={model} />
  ) : taskSource === 'gitlab' ? (
    <TaskPageGitLabFilters model={model} />
  ) : null
}
