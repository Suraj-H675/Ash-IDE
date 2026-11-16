import { readFileSync } from 'node:fs'
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
        /renderPluginsSettingsSection|PluginsSettingsSection|PluginsStatusSegment|PluginStatusBarItems|openPluginsSettings|createPluginsSettingsShortcutHandler|['"]view\.plugins['"]/
      )
    }
    expect(rendererSource('components/settings/page/settings-page-renderer.tsx')).toContain(
      'renderAppearanceSettingsSection(context)'
    )
    expect(rendererSource('components/status-bar/StatusBarSurface.tsx')).toContain(
      '<UpdateStatusSegment'
    )
  })
})
