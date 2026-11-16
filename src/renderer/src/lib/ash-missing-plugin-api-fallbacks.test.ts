// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireLegacyAppPluginsApi } from './legacy-app-plugins-api'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ settings: { pluginReplacementsOff: [] }, activeWorktreeId: 'local' })
  }
}))

vi.mock('@/store/plugin-panels', () => ({
  usePluginPanelsStore: { getState: () => ({ plugins: [{ pluginKey: 'synthetic' }] }) },
  collectActivePluginCommands: () => [
    {
      pluginKey: 'synthetic',
      id: 'replace',
      context: 'workspace',
      replaces: 'sidebar.left.toggle'
    }
  ]
}))

const { runBuiltInOrReplacement } = await import('./plugin-command-replacements')

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')
afterEach(() => {
  if (originalApi) {
    Object.defineProperty(window, 'api', originalApi)
  } else {
    Reflect.deleteProperty(window, 'api')
  }
})

describe('Ash built-in commands with the excluded application-plugin API', () => {
  it('runs the retained built-in action immediately even if old plugin metadata proposes a replacement', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    const builtIn = vi.fn()
    runBuiltInOrReplacement('sidebar.left.toggle', builtIn)
    expect(builtIn).toHaveBeenCalledOnce()
  })

  it('fails explicitly instead of presenting a synthetic installer to unmounted Orca UI', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    expect(() => requireLegacyAppPluginsApi()).toThrow(
      'Application plugins are not supported in Ash IDE'
    )
  })
})
