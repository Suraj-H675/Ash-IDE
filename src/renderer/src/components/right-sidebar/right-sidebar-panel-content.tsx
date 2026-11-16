import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import type { ActiveRightSidebarTab } from '@/store/slices/editor'

const FileExplorer = lazy(() => import('./file-explorer/panel/FileExplorer'))
const SourceControl = lazy(() => import('./source-control/panel/SourceControl'))
const ChecksPanel = lazy(() => import('./checks-panel/ChecksPanel'))
const PortsPanel = lazy(() => import('./PortsPanel'))
const AiVaultSidebarPanel = lazy(() => import('./ai-vault/panel/AiVaultSidebarPanel'))
const FolderWorkspaceWorktreesPanel = lazy(() => import('./FolderWorkspaceWorktreesPanel'))
const FolderWorkspacePrChecksPanel = lazy(
  () => import('./hosted-review/folder-checks/FolderWorkspacePrChecksPanel')
)

type RightSidebarPanelContentProps = {
  effectiveTab: ActiveRightSidebarTab
  rightSidebarOpen: boolean
}

export function RightSidebarPanelContent({
  effectiveTab,
  rightSidebarOpen
}: RightSidebarPanelContentProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={null}>
        {effectiveTab === 'explorer' && <FileExplorer />}
        {effectiveTab === 'source-control' && <SourceControl />}
        {effectiveTab === 'checks' && <ChecksPanel />}
        {/* SSH forwarding needs raw ports.detect data absent from the workspace-scoped status popover. */}
        {effectiveTab === 'ports' && (
          <PortsPanel isVisible={rightSidebarOpen && effectiveTab === 'ports'} />
        )}
        {effectiveTab === 'vault' && <AiVaultSidebarPanel />}
        {effectiveTab === 'workspaces' && <FolderWorkspaceWorktreesPanel />}
        {effectiveTab === 'pr-checks' && (
          <FolderWorkspacePrChecksPanel
            isVisible={rightSidebarOpen && effectiveTab === 'pr-checks'}
          />
        )}
      </Suspense>
    </div>
  )
}
