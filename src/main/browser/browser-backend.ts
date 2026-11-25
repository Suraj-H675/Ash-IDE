// Renderer webviews and headless offscreen pages share BrowserManager; creation and teardown differ.

export type BrowserBackendCreateTab = {
  url: string
  worktreeId?: string
  profileId?: string
  browserPageId?: string
  /** Wait for the requested URL to settle when restoring an existing saved tab. */
  waitForInitialLoad?: boolean
}

export type BrowserBackend = {
  /** Create a browser page and register its WebContents. Returns the page id. */
  createTab(params: BrowserBackendCreateTab): Promise<{ browserPageId: string }>
  closeTab(browserPageId: string): Promise<void>
  /** Retire only resources owned by this backend for the removed workspace. */
  closeWorktreeTabs?(worktreeId: string): Promise<void>
  /** True only for pages this backend created; the bridge also lists an attached window's webviews. */
  ownsTab(browserPageId: string): boolean
  /** Current WebContents identity for owner-scoped handoff checks. */
  getWebContentsId?(browserPageId: string): number | null
  /** Renderer backends may omit shutdown cleanup because their window owns the pages. */
  destroyAll?(): void | Promise<void>
}
