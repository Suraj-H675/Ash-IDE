export function shouldQuitWhenAllWindowsClosed(options: {
  platform: NodeJS.Platform
  isQuitting: boolean
  isServeMode: boolean
  hasOpenedMainWindow: boolean
}): boolean {
  if (options.isQuitting) {
    return true
  }
  // Hidden helper windows (extension native pages) can close before the first main window exists.
  if (options.isServeMode || !options.hasOpenedMainWindow) {
    return false
  }
  // Ash owns sessions in the persistent main process. Closing the last disposable
  // presentation must not tear down local RPC, agents, or their daemon.
  // Only an explicit quit (isQuitting) may stop the runtime.
  return false
}
