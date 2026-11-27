/** Per-profile extension setup and restore behavior supplied by browser-extension-startup. */
export type BrowserExtensionSessionHooks = {
  attached: (sess: Electron.Session, profileId: string, enabledExtensionIds: string[]) => void
  /** Runs after every successful extension load; resolves when restored state is back in place. */
  loaded: (
    sess: Electron.Session,
    profileId: string,
    extension: Electron.Extension
  ) => Promise<void>
  /** Clears desired enablement after a genuine restore failure and confirmed native unload. */
  postLoadFailed: (sess: Electron.Session, profileId: string, extensionId: string) => void
  /** Extensions turned off: undo what `attached` added to the request path. */
  detached: (sess: Electron.Session) => void
  uninstalled: (profileId: string, extensionIds: ReadonlySet<string>) => void
}
