// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEffectiveKeybindingsForDefinition } from '../../../../../shared/keybindings/effective'
import { getKeybindingDefinition } from '../../../../../shared/keybindings/definitions'
import { agentTabActionId } from '../../../../../shared/keybindings/definitions'
import { buildShortcutDefinitionCatalog } from './shortcut-definition-catalog'
import { getCmdJQuickActions } from '../../cmd-j/quick-actions'
import { buildCmdJActionResults } from '../../cmd-j/palette-results'
import { TabBarStaticCreateMenu } from '../../tab-bar/tab-bar-static-create-menu'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

const fromRenderer = (file: string): string =>
  readFileSync(resolve(process.cwd(), 'src/renderer/src', file), 'utf8')

const fakePluginCommand = {
  pluginKey: 'untrusted.plugin',
  id: 'run',
  title: 'Injected plugin command',
  pluginName: 'Untrusted Plugin',
  context: 'workspace',
  keybindings: [{ key: 'Ctrl+Alt+P' }]
}

afterEach(() => vi.unstubAllGlobals())

describe('Ash palette and shortcut Settings retain built-ins without application plugins', () => {
  it('does not accept injected plugin keyboard definitions while preserving built-in action remaps', () => {
    const overrides = { 'sidebar.left.toggle': ['Ctrl+Shift+B'] }
    const catalog = buildShortcutDefinitionCatalog({
      disabledTuiAgents: [],
      keybindings: overrides,
      pluginCommands: [fakePluginCommand],
      platform: 'linux',
      missionControlConflictMessage: 'Mission Control owns this chord'
    } as never)
    const leftSidebar = catalog.definitionsByAction.get('sidebar.left.toggle')
    expect(leftSidebar).toBeDefined()
    expect(leftSidebar?.id).toBe(getKeybindingDefinition('sidebar.left.toggle')?.id)
    expect(getEffectiveKeybindingsForDefinition(leftSidebar!, 'linux', overrides)).toEqual(
      overrides['sidebar.left.toggle']
    )
    expect(catalog.definitions.some((definition) => definition.title.includes('Injected'))).toBe(
      false
    )
    expect(catalog.groups.length).toBeGreaterThan(0)
    expect(catalog.ignoredConflictActionIds).toEqual([])
  })

  it('continues to include built-in command-palette actions with stable IDs', () => {
    const ids = buildCmdJActionResults(getCmdJQuickActions()).map((action) => action.id)
    expect(ids).toContain('new-terminal-tab')
    expect(ids).toContain('new-markdown-file')
    expect(ids).toContain('new-browser-tab')
    expect(ids.some((id) => id.startsWith('plugin:') || id.startsWith('plugin-new-file:'))).toBe(
      false
    )
  })

  it('still reports conflicting user-customized built-in shortcuts', () => {
    const catalog = buildShortcutDefinitionCatalog({
      disabledTuiAgents: [],
      keybindings: {
        'sidebar.left.toggle': ['Ctrl+Shift+L'],
        'sidebar.right.toggle': ['Ctrl+Shift+L']
      },
      platform: 'linux',
      missionControlConflictMessage: 'System shortcut'
    })
    expect(catalog.conflictByAction.get('sidebar.left.toggle')?.length).toBeGreaterThan(0)
    expect(catalog.conflictByAction.get('sidebar.right.toggle')?.length).toBeGreaterThan(0)
  })

  it('still hides a disabled agent launch binding without hiding built-in shortcuts', () => {
    const catalog = buildShortcutDefinitionCatalog({
      disabledTuiAgents: ['codex'],
      keybindings: {},
      platform: 'linux',
      missionControlConflictMessage: 'System shortcut'
    })
    expect(catalog.definitionsByAction.has(agentTabActionId('codex'))).toBe(false)
    expect(catalog.ignoredConflictActionIds).toContain(agentTabActionId('codex'))
    expect(catalog.definitionsByAction.has('sidebar.left.toggle')).toBe(true)
  })

  it('does not show injected app-plugin file types in the normal New Tab menu', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <TabBarStaticCreateMenu
            terminalOnly={false}
            mobileEmulatorEnabled={false}
            managedBrowserCreationEnabled
            mobileEmulatorCreationEnabled={false}
            workspaceHasSimulatorTab={false}
            showMobileEmulatorIntroCallout={false}
            props={
              {
                onNewTerminalTab: () => {},
                onNewFileTab: () => {},
                onOpenFileTab: () => {},
                onNewBrowserTab: () => {}
              } as never
            }
            windowsShellEntries={undefined}
            defaultWindowsPowerShellImplementation={null as never}
            pwshAvailable={false}
            newTerminalShortcut=""
            newBrowserShortcut=""
            newSimulatorShortcut=""
            newFileShortcut=""
            openMarkdownShortcut={null}
            queueNewActiveTerminalFocusAfterNewTabMenuClose={() => {}}
          />
        )
      })
      expect(host.textContent).toContain('New Terminal')
      expect(host.textContent).toContain('New Markdown')
      expect(host.textContent).toContain('New Browser Tab')
      expect(host.textContent).not.toContain('Injected plugin file')
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('excludes plugin command/file creators from all three active contribution routes', () => {
    const state = fromRenderer('components/worktree-jump/use-worktree-jump-palette-store-state.ts')
    const palette = fromRenderer(
      'components/worktree-jump/use-worktree-jump-palette-project-targets.ts'
    )
    const shortcuts = fromRenderer('components/settings/shortcuts/ShortcutsPane.tsx')
    const catalog = fromRenderer('components/settings/shortcuts/shortcut-definition-catalog.ts')
    const menu = fromRenderer('components/tab-bar/tab-bar-static-create-menu.tsx')
    for (const content of [state, palette, shortcuts, catalog, menu]) {
      expect(content).not.toMatch(
        /usePluginCommands|useEditablePluginCommands|usePluginNewFiles|buildPluginQuickActions|buildPluginNewFileQuickActions|buildPluginCommandKeybindingDefinitions|pluginNewFileMenuItems|PluginContributionIcon/
      )
    }
    expect(palette).toContain('getCmdJQuickActions')
    expect(shortcuts).toContain('buildShortcutDefinitionCatalog')
    expect(catalog).toContain('findKeybindingConflictsForDefinitions')
    expect(menu).toContain('newMarkdownMenuItem')
    expect(menu).toContain('defaultTerminalMenuItems')
    for (const file of [
      'components/cmd-j/plugin-quick-actions.ts',
      'lib/plugin-command-keybindings.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), 'src/renderer/src', file)), file).toBe(false)
    }
  })
})
