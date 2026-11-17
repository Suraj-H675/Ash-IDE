import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRemoteSettingsSections } from '../../../hooks/settings-navigation-remote-sections'
import { groupDefinitions } from '../shortcuts/shortcut-groups'

function rendererSource(path: string): string {
  return readFileSync(resolve(process.cwd(), 'src/renderer/src', path), 'utf8')
}

describe('Ash excluded application-plugin UI entrypoints', () => {
  it('does not advertise a plugin marketplace/settings section on desktop or web', () => {
    for (const isWebClient of [false, true]) {
      const sections = buildRemoteSettingsSections(
        { isMac: false, isWebClient, isDev: false, repos: [] } as never,
        { title: 'Runtime', description: 'Local runtime', keywords: ['runtime'] } as never,
        new Map()
      )
      expect(sections.map((section) => section.id)).not.toContain('plugins')
      expect(sections.map((section) => section.id)).toContain('privacy')
      expect(sections.map((section) => section.id)).toContain('experimental')
      expect(JSON.stringify(sections)).not.toMatch(/Install and manage Orca plugins/)
    }
  })

  it('does not present an Open Plugins keybinding in normal shortcut settings', () => {
    const ids = groupDefinitions([]).flatMap((group) => group.items.map((item) => item.id))
    expect(ids).not.toContain('view.plugins')
    expect(ids).toContain('app.settings')
    expect(ids).toContain('view.tasks')
  })

  it('does not mount legacy plugin panels or shortcuts from the active UI shells', () => {
    const surfaces = [
      'components/settings/page/settings-page-renderer.tsx',
      'components/settings/page/settings-advanced-section-renderers.tsx',
      'components/status-bar/StatusBarSurface.tsx',
      'app-shell/app-command-handlers.ts',
      'app-shell/use-global-keybindings.ts'
    ]
    for (const path of surfaces) {
      const source = rendererSource(path)
      expect(source, path).not.toMatch(
        /renderPluginsSettingsSection|PluginsSettingsSection|PluginsStatusSegment|PluginStatusBarItems|openPluginsSettings|createPluginsSettingsShortcutHandler|['"]view\.plugins['"]|pane:\s*['"]plugins['"]/
      )
    }
    expect(rendererSource('components/settings/page/settings-page-renderer.tsx')).toContain(
      'renderAppearanceSettingsSection(context)'
    )
    expect(rendererSource('components/status-bar/StatusBarSurface.tsx')).toContain(
      '<UpdateStatusSegment'
    )
  })

  it('removes the orphan marketplace renderer groups and their only private helpers', () => {
    const excluded = [
      'components/plugins/catalog',
      'components/plugins/dialogs',
      'components/plugins/list',
      'components/plugins/page',
      'components/plugins/review',
      'components/plugins/state/plugin-try-action.ts',
      'components/plugins/state/use-plugin-art-palettes.ts',
      'components/plugins/state/use-plugin-browse-request.ts',
      'components/plugins/state/plugin-preview-cache.ts',
      'components/plugins/state/use-plugin-install-action.ts',
      'components/plugins/state/use-plugin-catalog.ts',
      'components/plugins/state/use-plugin-contribution-source.ts',
      'components/plugins/state/use-plugin-declared-settings.ts',
      'components/plugins/state/use-plugin-hover-prefetch.ts',
      'components/plugins/state/use-plugin-in-use.ts',
      'components/plugins/state/use-plugin-install-link.ts',
      'components/plugins/state/use-plugin-logs.ts',
      'components/plugins/state/use-plugin-marketplace-lifecycle.ts',
      'components/plugins/state/use-plugin-page-model.ts',
      'components/plugins/state/use-plugin-page-navigation.ts',
      'components/plugins/state/use-plugin-review-queue.ts',
      'components/plugins/state/use-plugin-rollback-version.ts',
      'components/plugins/state/use-plugin-settings-writes.ts',
      'components/plugins/state/use-plugin-update-dialog.ts',
      'components/status-bar/PluginsStatusSegment.tsx',
      'lib/open-plugins-settings.ts',
      'store/plugin-install-counts.ts',
      'store/plugin-preview-request.ts',
      'store/plugin-update-review-toast.ts',
      'components/plugins/presentation/plugin-install-count.ts',
      'components/settings/appearance/themes/use-catalog-app-themes.ts',
      'components/settings/plugins/plugins-search.ts'
    ]
    for (const path of excluded) {
      expect(existsSync(resolve(process.cwd(), 'src/renderer/src', path)), path).toBe(false)
    }
    expect(rendererSource('store/plugin-auto-updates.ts')).not.toMatch(
      /takeUpdateReviewNotices|announcePluginUpdateReviews/
    )

    const activeSurfaces = [
      'components/settings/page/settings-page-renderer.tsx',
      'components/settings/page/settings-advanced-section-renderers.tsx',
      'components/status-bar/StatusBarSurface.tsx',
      'app-shell/app-command-handlers.ts',
      'app-shell/use-global-keybindings.ts'
    ]
    for (const path of activeSurfaces) {
      expect(rendererSource(path), path).not.toMatch(
        /components\/plugins\/(catalog|dialogs|list|page|review)\/|use-catalog-app-themes/
      )
    }

    const cardPrimitives = rendererSource(
      'components/sidebar/workspace-card/template/card-primitives.tsx'
    )
    expect(cardPrimitives).toContain('@/components/plugins/declarative/PluginDeclarativeDisplay')
    expect(cardPrimitives).toContain('@/components/plugins/declarative/plugin-declarative-icons')
  })

  it('removes orphan plugin presentation and trust state while retaining card and theme helpers', () => {
    const removed = [
      'components/plugins/presentation/plugin-access-profile.ts',
      'components/plugins/presentation/plugin-capability-presentation.ts',
      'components/plugins/presentation/plugin-consent-copy.ts',
      'components/plugins/presentation/plugin-contribution-file-list.ts',
      'components/plugins/presentation/plugin-contribution-row-labels.ts',
      'components/plugins/presentation/plugin-contributions.ts',
      'components/plugins/presentation/plugin-custom-editor-takeover.ts',
      'components/plugins/presentation/plugin-error-presentation.ts',
      'components/plugins/presentation/plugin-git-install-presentation.ts',
      'components/plugins/presentation/plugin-install-source.ts',
      'components/plugins/presentation/plugin-install-trust.ts',
      'components/plugins/presentation/plugin-keybinding-conflicts.ts',
      'components/plugins/presentation/plugin-official-label.ts',
      'components/plugins/presentation/plugin-publisher-trust.ts',
      'components/plugins/presentation/plugin-release-date.ts',
      'components/plugins/presentation/plugin-status-presentation.ts',
      'components/plugins/PluginContributionIcon.tsx',
      'store/plugin-install-trust-request.ts'
    ]
    for (const path of removed) {
      expect(existsSync(resolve(process.cwd(), 'src/renderer/src', path)), path).toBe(false)
    }

    const retained = [
      'components/plugins/declarative/PluginDeclarativeDisplay.tsx',
      'components/plugins/declarative/plugin-declarative-icons.ts',
      'components/plugins/plugin-icon-glyphs.ts',
      'components/plugins/state/plugin-theme-apply.ts',
      'components/plugins/state/plugin-action-toast.ts'
    ]
    for (const path of retained) {
      expect(existsSync(resolve(process.cwd(), 'src/renderer/src', path)), path).toBe(true)
    }
  })

  it('only offers built-in Appearance choices, not excluded app-plugin catalog installation', () => {
    const appearance = rendererSource(
      'components/settings/appearance/themes/AppearanceThemeControl.tsx'
    )
    for (const forbidden of [
      'requestPluginBrowse',
      'useCatalogAppThemes',
      'browseThemesActions',
      'catalog.install',
      'catalog.themes',
      'pluginThemeGroups'
    ]) {
      expect(appearance, forbidden).not.toContain(forbidden)
    }
    expect(appearance).toContain('SettingsSegmentedControl')
    expect(appearance).toContain('MATCH_TERMINAL_APP_THEME')
    expect(appearance).toContain('editorThemeSlotUpdate')
    expect(appearance).toContain('FOLLOW_APP')
    expect(rendererSource('components/settings/page/settings-page-renderer.tsx')).not.toContain(
      'PluginInstallTrustDialogHost'
    )
  })

  it('does not subscribe to retired plugin installer deep links', () => {
    for (const path of [
      'hooks/ipc-events/settings-sidebar-ipc-bridge.ts',
      'web/preload-api/web-ui-api.ts'
    ]) {
      const source = rendererSource(path)
      expect(source, path).not.toMatch(/onOpenPluginInstallLink|consumePendingPluginInstallLink/)
    }
    expect(rendererSource('hooks/ipc-events/settings-sidebar-ipc-bridge.ts')).toContain(
      'consumePendingOpenSettings'
    )
    expect(rendererSource('hooks/ipc-events/settings-sidebar-ipc-bridge.ts')).toContain(
      'onOpenSettings'
    )
  })
})
