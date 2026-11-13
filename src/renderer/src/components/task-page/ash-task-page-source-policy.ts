import { normalizeVisibleTaskProviders, type TaskProvider } from '../../../../shared/task-providers'

export type AshTaskPageProvider = Extract<TaskProvider, 'github' | 'gitlab'>

/** Historical Jira/Linear preferences must never re-enable removed Ash integrations. */
export function normalizeAshTaskPageSources(saved: unknown): AshTaskPageProvider[] {
  const supported = normalizeVisibleTaskProviders(saved).filter(
    (provider): provider is AshTaskPageProvider => provider === 'github' || provider === 'gitlab'
  )
  return supported.length > 0 ? supported : ['github']
}

/** Keep saved provider data on disk; repair only the task-page's local selection. */
export function defaultAshTaskPageSource(
  saved: TaskProvider | null | undefined,
  visible: readonly AshTaskPageProvider[]
): AshTaskPageProvider {
  return saved === 'github' || saved === 'gitlab' ? saved : (visible[0] ?? 'github')
}
