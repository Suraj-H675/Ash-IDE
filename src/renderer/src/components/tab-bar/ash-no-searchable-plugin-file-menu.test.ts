import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTabCreateMenuOptions,
  findMatchingTabCreateMenuOptions,
  isTabCreateMenuQueryTooLarge
} from './tab-create-menu-options'

const tabBarRoot = 'src/renderer/src/components/tab-bar/'
const source = (filename: string): string =>
  readFileSync(resolve(process.cwd(), tabBarRoot, filename), 'utf8')

function builtInOptions() {
  return buildTabCreateMenuOptions({
    hasNewBrowser: true,
    hasNewMarkdown: true,
    hasOpenMarkdown: true,
    hasSimulator: false,
    simulatorIsGoTo: false,
    terminalOnly: false
  })
}

describe('Ash searchable tab creation excludes general application-plugin file types', () => {
  it('retains the built-in searchable terminal, browser and Markdown creation options', () => {
    const options = builtInOptions()
    expect(options.map((item) => item.kind)).toEqual([
      'new-terminal',
      'new-browser',
      'new-markdown',
      'open-markdown'
    ])
    expect(findMatchingTabCreateMenuOptions('terminal', options)[0]?.id).toBe('new-terminal')
    expect(findMatchingTabCreateMenuOptions('new browser', options)[0]?.id).toBe('new-browser')
    expect(findMatchingTabCreateMenuOptions('new markdown', options)[0]?.id).toBe('new-markdown')
    expect(findMatchingTabCreateMenuOptions('open markdown', options)[0]?.id).toBe('open-markdown')
  })

  it('retains Windows shell options and original no-workspace/terminal-only guards', () => {
    const shells = buildTabCreateMenuOptions({
      hasNewBrowser: false,
      hasNewMarkdown: false,
      hasOpenMarkdown: false,
      hasSimulator: false,
      simulatorIsGoTo: false,
      terminalOnly: false,
      windowsShellEntries: [{ shell: 'powershell.exe', label: 'PowerShell' }]
    })
    expect(shells.map((item) => item.kind)).toEqual(['new-terminal-shell'])
    expect(findMatchingTabCreateMenuOptions('PowerShell', shells)[0]?.id).toContain(
      'powershell.exe'
    )
    expect(
      buildTabCreateMenuOptions({
        hasNewBrowser: true,
        hasNewMarkdown: true,
        hasOpenMarkdown: true,
        hasSimulator: false,
        simulatorIsGoTo: false,
        terminalOnly: true
      })
    ).toEqual([])
    expect(isTabCreateMenuQueryTooLarge('x'.repeat(2049))).toBe(true)
    expect(findMatchingTabCreateMenuOptions('x'.repeat(2049), shells)).toEqual([])
  })

  it('does not mount plugin-created options in the live tab strip or searchable results', () => {
    for (const filename of [
      'TabBar.tsx',
      'TabBarCreateEntryRow.tsx',
      'tab-create-menu-options.ts',
      'use-tab-bar-create-menu-controller.ts'
    ]) {
      expect(source(filename), filename).not.toMatch(
        /usePluginNewFileMenuOptions|withPluginNewFileMenuOptions|PluginContributionIcon|new-plugin-file|pluginNewFile/
      )
    }
    expect(source('TabBar.tsx')).toContain('baseCreateMenu')
    expect(source('TabBar.tsx')).toContain('renderTabBarSurface')
    expect(source('TabBarCreateEntryRow.tsx')).toContain('new-browser')
    expect(source('TabBarCreateEntryRow.tsx')).toContain('new-markdown')
    expect(source('use-tab-bar-create-menu-controller.ts')).toContain("case 'new-terminal-shell'")
    expect(source('use-tab-bar-create-menu-controller.ts')).toContain("case 'new-markdown'")
    expect(
      existsSync(resolve(process.cwd(), tabBarRoot, 'use-plugin-new-file-menu-options.ts'))
    ).toBe(false)
  })

  it('preserves the separate editor draft/save contracts pending a no-data-loss audit', () => {
    expect(existsSync(resolve(process.cwd(), 'src/renderer/src/store/plugin-new-files.ts'))).toBe(
      true
    )
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/renderer/src/store/slices/editor/actions/untitled-file-creation.ts'
        )
      )
    ).toBe(true)
  })
})
