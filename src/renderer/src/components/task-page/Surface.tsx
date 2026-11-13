import type { TaskPageComposerActionsModel } from './use-task-page-composer-actions'
import { TaskPageFrame } from './Frame'
import { TaskPageGitHubIssueDialog } from './github/IssueDialog'
import { TaskPageGitLabDialog } from './gitlab/Dialog'
export function TaskPageSurface({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <TaskPageFrame model={model} />

      <TaskPageGitHubIssueDialog model={model} />
      <TaskPageGitLabDialog model={model} />
    </div>
  )
}
