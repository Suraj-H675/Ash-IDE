export const APP_THEME_TOKENS = [
  '--background',
  '--editor-surface',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--worktree-sidebar',
  '--worktree-sidebar-foreground',
  '--worktree-sidebar-accent',
  '--worktree-sidebar-accent-foreground',
  '--worktree-sidebar-border',
  '--worktree-sidebar-ring',
  '--worktree-sidebar-active',
  '--worktree-sidebar-active-border',
  '--host-badge',
  '--host-badge-foreground',
  '--tab-bar',
  '--tab-active',
  '--tab-active-foreground',
  '--tab-active-indicator',
  '--tab-inactive',
  '--tab-inactive-foreground',
  '--split-divider',
  '--split-divider-hover',
  '--chat-user-message',
  '--text-link',
  '--diff-added',
  '--diff-added-background',
  '--diff-added-emphasis',
  '--diff-added-gutter',
  '--diff-removed',
  '--diff-removed-background',
  '--diff-removed-emphasis',
  '--diff-removed-gutter',
  '--git-decoration-added',
  '--git-decoration-modified',
  '--git-decoration-deleted',
  '--git-decoration-renamed',
  '--git-decoration-untracked',
  '--git-decoration-copied',
  '--git-decoration-ignored'
] as const

// Why: an omitted token would otherwise keep the built-in value and clash with the theme's
// palette (e.g. a neutral grey selected row on a purple theme). A rule names source tokens
// (first present wins) or mixes the theme's foreground into its background (or `into`); the
// renderer's contrast check still drops any derived pair that ends up unreadable.
export type ThemeDerivationRule = readonly string[] | { mixForeground: number; into?: string }

const DERIVED_TOKENS: Record<string, ThemeDerivationRule> = {
  '--editor-surface': ['--background'],
  '--card': ['--background'],
  '--card-foreground': ['--foreground'],
  '--popover': ['--card', '--background'],
  '--popover-foreground': ['--card-foreground', '--foreground'],
  '--primary': ['--foreground'],
  '--primary-foreground': ['--background'],
  '--muted': ['--secondary'],
  '--secondary': ['--muted'],
  '--muted-foreground': { mixForeground: 70 },
  '--border': { mixForeground: 16 },
  '--accent': { mixForeground: 12 },
  '--accent-foreground': ['--foreground'],
  '--secondary-foreground': ['--foreground'],
  '--input': ['--border'],
  '--ring': ['--primary'],
  // Why a lift: Orca draws no line between the left sidebar and the canvas; the surface step is
  // the divider, so a sidebar equal to the background leaves no edge at all.
  '--sidebar': { mixForeground: 8 },
  '--sidebar-foreground': ['--foreground'],
  '--sidebar-primary': ['--primary'],
  '--sidebar-primary-foreground': ['--primary-foreground'],
  '--sidebar-accent': ['--accent'],
  '--sidebar-accent-foreground': ['--accent-foreground'],
  '--sidebar-border': ['--border'],
  '--sidebar-ring': ['--ring'],
  '--worktree-sidebar': ['--sidebar'],
  '--worktree-sidebar-foreground': ['--sidebar-foreground'],
  '--worktree-sidebar-accent': ['--sidebar-accent'],
  '--worktree-sidebar-accent-foreground': ['--sidebar-accent-foreground'],
  '--worktree-sidebar-border': ['--sidebar-border'],
  '--worktree-sidebar-ring': ['--sidebar-ring'],
  '--chart-1': ['--primary']
}

/** Fills omitted tokens from the ones the theme set, in dependency order. */
export function completeAppThemeTokens(tokens: Record<string, string>): Record<string, string> {
  const complete = { ...tokens }
  for (const [token, rule] of Object.entries(DERIVED_TOKENS)) {
    if (complete[token]) {
      continue
    }
    const derived =
      'mixForeground' in rule
        ? `color-mix(in srgb, ${complete['--foreground']} ${rule.mixForeground}%, ${complete['--background']})`
        : rule.map((source) => complete[source]).find(Boolean)
    if (derived) {
      complete[token] = derived
    }
  }
  return complete
}
