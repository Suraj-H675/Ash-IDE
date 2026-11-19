// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeRightSidebarTab } from '../../../../main/persistence/applying-settings/ui-selection-normalization'
import { normalizeRightSidebarRoute } from '../../store/right-sidebar-route'
import { getVisibleRightSidebarActivityItems } from './right-sidebar-activity-visibility'
import { resolveRightSidebarEffectiveTab } from './right-sidebar-effective-tab'
import { RightSidebarPanelContent } from './right-sidebar-panel-content'

vi.mock('@/lib/lazy-with-retry', () => ({
  lazyWithRetry: () => () => <div data-testid="built-in-sidebar-panel">Retained sidebar</div>
}))

afterEach(() => vi.unstubAllGlobals())

const tabs = [
  { id: 'explorer' as const },
  { id: 'vault' as const },
  { id: 'source-control' as const },
  { id: 'checks' as const },
  { id: 'workspaces' as const }
]

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash right sidebar excludes general application-plugin panels', () => {
  it('normalizes old persisted plugin tabs to Explorer without losing the legacy Search route', () => {
    expect(normalizeRightSidebarTab('plugin:acme.example/sidebar')).toBe('explorer')
    expect(normalizeRightSidebarRoute('plugin:acme.example/sidebar')).toEqual({
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'files'
    })
    expect(normalizeRightSidebarRoute('search')).toEqual({
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'search'
    })
    for (const tab of [
      'explorer',
      'vault',
      'workspaces',
      'pr-checks',
      'source-control',
      'checks',
      'ports'
    ] as const) {
      expect(normalizeRightSidebarTab(tab)).toBe(tab)
      expect(normalizeRightSidebarRoute(tab).rightSidebarTab).toBe(tab)
    }
  })

  it('preserves normal workspace-aware fallback and folder tab memory', () => {
    expect(
      resolveRightSidebarEffectiveTab({
        normalizedActiveTab: normalizeRightSidebarRoute('plugin:acme.example/sidebar')
          .rightSidebarTab,
        visibleItems: tabs,
        activeFolderWorkspaceKey: null,
        rememberedFolderTab: null
      })
    ).toBe('explorer')
    expect(
      resolveRightSidebarEffectiveTab({
        normalizedActiveTab: 'explorer',
        visibleItems: tabs,
        activeFolderWorkspaceKey: 'folder:original',
        rememberedFolderTab: 'workspaces'
      })
    ).toBe('workspaces')
    expect(
      resolveRightSidebarEffectiveTab({
        normalizedActiveTab: 'checks',
        visibleItems: tabs,
        activeFolderWorkspaceKey: null,
        rememberedFolderTab: null
      })
    ).toBe('checks')
  })

  it('preserves built-in folder/git/remote-ports visibility rules', () => {
    const icon = () => null
    const candidates = [
      { id: 'explorer' as const, title: 'Explorer', icon, shortcut: '' },
      { id: 'source-control' as const, title: 'Source Control', icon, shortcut: '', gitOnly: true },
      { id: 'workspaces' as const, title: 'Workspaces', icon, shortcut: '', folderOnly: true },
      { id: 'ports' as const, title: 'Ports', icon, shortcut: '', sshOnly: true }
    ]
    expect(
      getVisibleRightSidebarActivityItems(candidates, {
        isFolder: false,
        isFolderWorkspace: false,
        hasSshHost: false
      }).map((tab) => tab.id)
    ).toEqual(['explorer', 'source-control'])
    expect(
      getVisibleRightSidebarActivityItems(candidates, {
        isFolder: true,
        isFolderWorkspace: true,
        hasSshHost: true
      }).map((tab) => tab.id)
    ).toEqual(['explorer', 'workspaces', 'ports'])
  })

  it('never mounts plugin panel content for an injected obsolete tab', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          // @ts-expect-error The test injects an obsolete route that the active type excludes.
          <RightSidebarPanelContent effectiveTab="plugin:acme.example/sidebar" rightSidebarOpen />
        )
      })
      expect(host.querySelector('[data-testid="built-in-sidebar-panel"]')).toBeNull()
      expect(host.querySelector('[data-plugin-panel-surface]')).toBeNull()
      await act(async () => {
        root.render(<RightSidebarPanelContent effectiveTab="explorer" rightSidebarOpen />)
      })
      expect(host.querySelector('[data-testid="built-in-sidebar-panel"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('does not import panel workers, plugin registries or plugin activity hooks into live sidebar', () => {
    const root = 'src/renderer/src/components/right-sidebar/'
    for (const file of [
      'use-right-sidebar-activity-items.ts',
      'use-right-sidebar-tab-routing.ts',
      'right-sidebar-panel-content.tsx',
      'index.tsx'
    ]) {
      const content = source(root + file)
      expect(content, file).not.toMatch(
        /usePluginPanels|pluginSystemEnabled|installedPluginTabKeys|PluginPanel|isPluginPanelTabKey|plugin-panel-activity-items|useInstalledPluginRouteReconciliation/
      )
    }
    for (const file of [
      'plugin-panels/use-installed-plugin-route-reconciliation.ts',
      'plugin-panels/plugin-panel-activity-items.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), `${root}${file}`)), file).toBe(false)
    }
    expect(source('src/renderer/src/store/right-sidebar-route.ts')).not.toMatch(
      /isPluginPanelTabKey|installedPluginTabKeys/
    )
    expect(
      source('src/main/persistence/applying-settings/ui-selection-normalization.ts')
    ).not.toMatch(/isPluginPanelTabKey/)
  })

  it('contains no legacy app-plugin panel component or declarative guest renderer', () => {
    const root = 'src/renderer/src/components/right-sidebar/plugin-panels/'
    for (const file of [
      'PluginPanel.tsx',
      'declarative/PluginDeclarativePanel.tsx',
      'declarative/PluginDeclarativePanelNotices.tsx',
      'declarative/plugin-declarative-gesture-stability.ts',
      'declarative/plugin-declarative-retained-memory.ts',
      'declarative/use-plugin-declarative-images.ts',
      'declarative/use-plugin-declarative-state.ts',
      'declarative/use-plugin-declarative-tree.ts',
      'health/plugin-panel-act-driver.ts',
      'health/plugin-panel-draw-status.ts',
      'health/use-plugin-panel-draw-report.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), root + file)), file).toBe(false)
    }
    // The now-orphaned frame host and its last watchdog consumer are retired together.
    expect(existsSync(resolve(process.cwd(), `${root}health/plugin-panel-watchdog.ts`))).toBe(false)
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/renderer/src/components/plugins/frames/use-plugin-frame-host.ts'
        )
      )
    ).toBe(false)
    expect(
      source('src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx')
    ).toContain('<FileExplorer')
    expect(
      source('src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx')
    ).toContain('<AiVaultSidebarPanel')
  })
})
