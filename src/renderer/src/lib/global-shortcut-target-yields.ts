import type {
  KeybindingActionId,
  KeybindingInput,
  KeybindingMatchOptions,
  KeybindingOverrides
} from '../../../shared/keybindings'
import {
  type fileSearchClaimsTextKey,
  textFieldClaimsActionKey
} from './file-search-shortcut-policy'
import {
  isFloatingWorkspacePanelFocused,
  isFloatingWorkspaceTerminalInputTarget,
  matchFloatingWorkspacePanelChord
} from './floating-workspace-terminal-actions'

/** Retained input ownership: editable text and floating terminals/panels keep their chords. */
export function globalShortcutTargetYields(
  input: KeybindingInput & Parameters<typeof fileSearchClaimsTextKey>[0],
  platform: NodeJS.Platform,
  overrides: KeybindingOverrides | undefined,
  options: KeybindingMatchOptions,
  actionId?: KeybindingActionId
): boolean {
  return (
    textFieldClaimsActionKey(input, actionId) ||
    isFloatingWorkspaceTerminalInputTarget(input.target) ||
    (isFloatingWorkspacePanelFocused() &&
      matchFloatingWorkspacePanelChord(input, platform, null, overrides, options) !== null)
  )
}
