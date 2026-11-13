import React from 'react'
import { Command } from '@/components/ui/command'
import { Popover, PopoverAnchor } from '@/components/ui/popover'
import { SmartWorkspaceSourceTabs } from './SmartWorkspaceSourceTabs'
import { translate } from '@/i18n/i18n'
import { WorkspaceEmojiSuggestionPopover } from '@/components/workspace-emoji/WorkspaceEmojiSuggestionPopover'
import { renderSmartWorkspaceCrossRepoDialog } from './smart-workspace-cross-repo-dialog'
import { renderSmartWorkspaceNameInput } from './smart-workspace-name-input-surface'
import { renderSmartWorkspaceSourceResults } from './smart-workspace-source-results-surface'
import type { SmartWorkspaceNameFieldController } from './use-smart-workspace-name-field-controller'

export function renderSmartWorkspaceNameField(
  controller: SmartWorkspaceNameFieldController
): React.JSX.Element {
  const {
    mode,
    localInputRef,
    disabled,
    selectedSource,
    open,
    handleSourcePopoverOpenChange,
    resolvedCommandValue,
    isQueryStale,
    setCommandValue,
    emojiMenuOpen,
    resolvedEmojiCommandValue,
    emojiSuggestions,
    setEmojiCommandValue,
    handleEmojiSelect,
    setEmojiCursor
  } = controller

  return (
    <div className="min-w-0 space-y-1.5">
      {controller.textOnly ? null : (
        <SmartWorkspaceSourceTabs
          model={controller}
          onModeChange={controller.handleModeChange}
          inputRef={controller.localInputRef}
          tabsListRef={controller.tabsListRef}
        />
      )}
      <Popover
        open={!disabled && open && mode !== 'text' && selectedSource === null}
        onOpenChange={handleSourcePopoverOpenChange}
      >
        <Command
          value={resolvedCommandValue}
          onValueChange={(next) => {
            // cmdk re-emits on row reshapes; freeze selection while debounce trails the input.
            if (isQueryStale) {
              return
            }
            setCommandValue(next)
          }}
          shouldFilter={false}
          className="overflow-visible bg-transparent"
        >
          <PopoverAnchor asChild>
            <div className="relative min-w-0">{renderSmartWorkspaceNameInput(controller)}</div>
          </PopoverAnchor>
          {renderSmartWorkspaceSourceResults(controller)}
        </Command>
      </Popover>
      <WorkspaceEmojiSuggestionPopover
        anchorRef={localInputRef}
        open={emojiMenuOpen}
        commandValue={resolvedEmojiCommandValue}
        heading={translate('auto.components.new.workspace.SmartWorkspaceNameField.emoji', 'Emoji')}
        suggestions={emojiSuggestions}
        onCommandValueChange={setEmojiCommandValue}
        onSelect={handleEmojiSelect}
        onOpenChange={(next) => {
          if (!next) {
            setEmojiCursor(null)
          }
        }}
      />
      {renderSmartWorkspaceCrossRepoDialog(controller)}
    </div>
  )
}
