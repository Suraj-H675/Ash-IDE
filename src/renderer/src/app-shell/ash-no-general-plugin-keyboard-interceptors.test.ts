// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { globalShortcutTargetYields } from '../lib/global-shortcut-target-yields'
import { createAppCommandHandlers, getKeybindingContext } from './app-command-handlers'

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}

const root = 'src/renderer/src/'

describe('Ash retains its own keyboard commands without general-plugin overrides', () => {
  it('dispatches a built-in sidebar shortcut once even when old plugin state is injected', () => {
    const toggleSidebar = vi.fn()
    const actions = { toggleSidebar }
    const input = { defaultPrevented: false, preventDefault: vi.fn() }
    const handlers = createAppCommandHandlers(
      {
        activeView: 'terminal',
        activeWorktreeId: 'workspace',
        actions,
        creationLayoutActive: false,
        floatingTerminalEnabled: true,
        floatingTerminalOpen: false,
        floatingVisibleTabCount: 1,
        keybindings: {},
        openFloatingWorkspaceMaximized: vi.fn(),
        setFloatingTerminalOpen: vi.fn(),
        terminalShortcutPolicy: 'orca-first',
        workspaceChromeActive: true,
        pluginCommands: [{ pluginKey: 'untrusted', id: 'replace', replaces: 'sidebar.left.toggle' }]
      } as never,
      input as never
    )
    expect(handlers.get('sidebar.left.toggle')?.()).toBe(true)
    expect(toggleSidebar).toHaveBeenCalledOnce()
    expect(input.preventDefault).toHaveBeenCalledOnce()
  })

  it('keeps real terminal context recognition', () => {
    const xtermInput = document.createElement('textarea')
    xtermInput.className = 'xterm-helper-textarea'
    expect(getKeybindingContext(xtermInput)).toBe('terminal')
    expect(getKeybindingContext(document.createElement('input'))).toBe('app')
  })

  it('preserves focused text-field ownership while allowing app-level shortcuts', () => {
    const input = document.createElement('input')
    input.value = 'my edits'
    const editorChord = {
      target: input,
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false
    }
    expect(globalShortcutTargetYields(editorChord, 'linux', {}, { context: 'app' })).toBe(true)
    expect(
      globalShortcutTargetYields(
        { ...editorChord, target: document.createElement('div') },
        'linux',
        {},
        { context: 'app' }
      )
    ).toBe(false)
  })

  it('removes plugin shortcut precedence from live app and native-chat dispatch', () => {
    const global = source(`${root}app-shell/use-global-keybindings.ts`)
    const native = source(`${root}components/native-chat/use-native-chat-toggle-shortcut.ts`)
    for (const content of [global, native]) {
      expect(content).not.toMatch(/usePluginCommands|findPluginCommandForKeybinding/)
      expect(content).toContain('ModifierDoubleTapDetector')
    }
    expect(global).not.toMatch(/executePluginCommand|runBuiltInOrReplacement/)
    expect(global).toContain('keybindingMatchesAction')
    expect(global).toContain('globalShortcutTargetYields')
    expect(native).toContain('matchesRecentTabSwitcherChord')
    expect(native).toContain('matchesNativeChatToggleShortcut')
    expect(native).toContain('resolveKeyboardWorkspaceId')
  })

  it('preserves built-in menu and workspace commands without replacement workers', () => {
    for (const file of [
      'app-shell/app-command-handlers.ts',
      'hooks/ipc-events/settings-sidebar-ipc-bridge.ts',
      'hooks/ipc-events/workspace-shortcut-ipc-bridge.ts'
    ]) {
      expect(source(`${root}${file}`), file).not.toMatch(
        /runBuiltInOrReplacement|plugin-command-replacements|usePluginCommands/
      )
    }
    const handlers = source(`${root}app-shell/app-command-handlers.ts`)
    expect(handlers).toContain('showTerminalShortcutCaptureNotification')
    expect(handlers).toContain('actions.toggleSidebar()')
    expect(handlers).toContain('actions.showRightSidebarFiles()')
    expect(handlers).toContain('actions.showRightSidebarSearch()')
  })

  it('leaves target ownership in a plugin-independent helper and excludes worker replacement', () => {
    expect(existsSync(resolve(process.cwd(), `${root}lib/plugin-command-replacements.ts`))).toBe(
      false
    )
    const helper = source(`${root}lib/global-shortcut-target-yields.ts`)
    expect(helper).toContain('textFieldClaimsActionKey')
    expect(helper).toContain('isFloatingWorkspaceTerminalInputTarget')
    expect(helper).toContain('matchFloatingWorkspacePanelChord')
    expect(helper).not.toMatch(/ActivePluginCommand|findPluginCommandForKeybinding/)
    expect(source(`${root}lib/plugin-command-keybindings.ts`)).not.toContain(
      'export function globalShortcutTargetYields'
    )
  })
})
