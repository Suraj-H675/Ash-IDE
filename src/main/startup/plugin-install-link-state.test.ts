import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Ash general application-plugin deep-link exclusion', () => {
  it('never buffers or forwards retired plugin install links from Main', () => {
    const paths = [
      'src/main/startup/skill-share-deep-link-state.ts',
      'src/main/startup/main-process-state.ts',
      'src/main/startup/main-process-ipc-bootstrap.ts',
      'src/main/window/macos-desktop-handoff.ts'
    ]
    for (const path of paths) {
      expect(source(path), path).not.toMatch(
        /PluginInstallLinkState|pluginInstallLinks|ui:consumePendingPluginInstallLink/
      )
    }
    expect(source('src/main/startup/main-process-state.ts')).toContain(
      'skillShareDeepLinks: new SkillShareDeepLinkState()'
    )
  })

  it('does not expose the legacy plugin link IPC in desktop preload', () => {
    for (const path of [
      'src/preload/api/ui-command-event-api.ts',
      'src/preload/api/ui-bridge-state-and-menu-commands.ts'
    ]) {
      expect(source(path), path).not.toMatch(
        /onOpenPluginInstallLink|consumePendingPluginInstallLink|ui:openPluginInstallLink/
      )
    }
    expect(source('src/preload/api/ui-command-event-api.ts')).toContain(
      'consumePendingOpenSettings'
    )
  })
})
