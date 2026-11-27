const extensionsBySession = new WeakMap<Electron.Session, Map<string, string>>()

export function quarantineBrowserExtensionRuntime(
  session: Electron.Session,
  extensionId: string,
  reason: string
): void {
  const extensions = extensionsBySession.get(session) ?? new Map<string, string>()
  extensions.set(extensionId, reason)
  extensionsBySession.set(session, extensions)
}

export function clearBrowserExtensionRuntimeQuarantine(
  session: Electron.Session,
  extensionId: string
): void {
  const extensions = extensionsBySession.get(session)
  extensions?.delete(extensionId)
  if (extensions?.size === 0) {
    extensionsBySession.delete(session)
  }
}

export function getBrowserExtensionRuntimeQuarantine(
  session: Electron.Session,
  extensionId: string
): string | null {
  return extensionsBySession.get(session)?.get(extensionId) ?? null
}

export function throwIfBrowserExtensionRuntimeQuarantined(
  session: Electron.Session,
  extensionId: string
): void {
  const reason = getBrowserExtensionRuntimeQuarantine(session, extensionId)
  if (reason) {
    throw new Error(reason)
  }
}
