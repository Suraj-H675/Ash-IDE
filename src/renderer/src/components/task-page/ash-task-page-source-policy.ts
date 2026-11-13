import { normalizeVisibleTaskProviders, type TaskProvider } from '../../../../shared/task-providers'

export type AshTaskPageProvider = Extract<TaskProvider, 'github' | 'gitlab'>

/** The Tasks surface is deliberately limited to code-host providers, even when legacy state survives. */
export function isAshTaskPageProviderVisible(
  provider: TaskProvider,
  visibleProviders: readonly TaskProvider[]
): provider is AshTaskPageProvider {
  return (provider === 'github' || provider === 'gitlab') && visibleProviders.includes(provider)
}

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
