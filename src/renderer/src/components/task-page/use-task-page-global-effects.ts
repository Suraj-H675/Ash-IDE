import type { TaskPageGitHubIssueCreationModel } from './github/use-task-page-github-issue-creation'
import { useEffect } from 'react'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/app-keyboard-router'
import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
export function useTaskPageGlobalEffects(model: TaskPageGitHubIssueCreationModel) {
  const {
    closeTaskPage,
    activeModal,
    preflightStatusChecked,
    preflightStatusContextKey,
    refreshPreflightStatus,
    expectedPreflightContextKey,
    preflightStatusCurrent,
    githubListPending,
    tasksRefreshing,
    tasksFiltering,
    dialogWorkItem,
    gitlabDialogItem,
    newIssueOpen,
    selectedLinearIssue,
    selectedJiraIssue
  } = model
  const githubTasksBusy = githubListPending || tasksRefreshing || tasksFiltering
  useContextualTour(
    'tasks',
    !dialogWorkItem &&
      !gitlabDialogItem &&
      !selectedLinearIssue &&
      !selectedJiraIssue &&
      !newIssueOpen &&
      activeModal === 'none',
    'tasks_open'
  )
  useEffect(() => {
    // Why: when a modal is open, let it own Esc dismissal.
    if (
      dialogWorkItem ||
      selectedJiraIssue ||
      selectedLinearIssue ||
      newIssueOpen ||
      activeModal !== 'none'
    ) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      // Why: open menus/popovers/selects own Esc; capture-phase leave would steal it from Radix.
      if (
        document.querySelector(
          '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="select-content"], [role="menu"]'
        )
      ) {
        return
      }

      // Esc first blurs input; leave the page only when focus is outside one.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        event.preventDefault()
        target.blur()
        return
      }
      event.preventDefault()
      closeTaskPage()
    }
    addAppKeyListener('keydown', onKeyDown)
    return () => removeAppKeyListener('keydown', onKeyDown)
  }, [
    activeModal,
    closeTaskPage,
    dialogWorkItem,
    newIssueOpen,
    selectedLinearIssue,
    selectedJiraIssue
  ])
  useEffect(() => {
    // Ash's task surface supports code-host issues; do not probe excluded
    // Jira/Linear app connectors just because the page was opened.
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
  }, [
    expectedPreflightContextKey,
    preflightStatusContextKey,
    preflightStatusChecked,
    preflightStatusCurrent,
    refreshPreflightStatus
  ])

  const nextModel = model as typeof model & {
    githubTasksBusy: typeof githubTasksBusy
  }
  nextModel.githubTasksBusy = githubTasksBusy
  return nextModel
}
export type TaskPageGlobalEffectsModel = ReturnType<typeof useTaskPageGlobalEffects>
