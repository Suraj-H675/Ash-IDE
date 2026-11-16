import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash excludes the general application-plugin Main IPC tree', () => {
  it('has no installer, marketplace, frame, panel-push, settings or status-bar IPC registrar', () => {
    for (const path of [
      'src/main/ipc/plugins.ts',
      'src/main/ipc/plugin-frame-entry-ipc.ts',
      'src/main/ipc/plugin-marketplaces.ts',
      'src/main/ipc/plugin-panel-push-ipc.ts',
      'src/main/ipc/plugin-settings-ipc.ts',
      'src/main/ipc/plugin-status-bar-ipc.ts',
      'src/main/plugins/__mocks__/plugin-uninstall-log-test-fixture.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false)
    }
  })

  it('registers retained desktop IPC handlers but never a general application-plugin host', () => {
    const core = source('src/main/ipc/register-core-handlers/register-core-handlers.ts')
    expect(core).not.toMatch(
      /registerPluginHandlers|plugin-marketplaces|plugin-frame-entry-ipc|plugin-panel-push-ipc/
    )
    for (const retained of [
      'registerBrowserHandlers(store)',
      'registerFilesystemHandlers(store, commitMessageAgentEnv)',
      'registerRuntimeHandlers(runtime)',
      'registerNativeChatHandlers(',
      'registerAgentHookHandlers(',
      'registerEphemeralVmHandlers(store)'
    ]) {
      expect(core, retained).toContain(retained)
    }
    const preload = source('src/preload/index.ts')
    expect(preload).not.toMatch(/plugins:\s*pluginsApi/)
    expect(preload).toContain('browser: browserApi')
    expect(preload).toContain('pty: ptyApi')
  })
})
