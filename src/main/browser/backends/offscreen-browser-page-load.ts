import type { BrowserWindow } from 'electron'

const LOAD_TIMEOUT_MS = 30_000

export async function loadOffscreenBrowserUrl(win: BrowserWindow, url: string): Promise<void> {
  const wc = win.webContents
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      // Missing did-finish-load must not make a slow or about:blank tab unusable.
      resolve()
    }, LOAD_TIMEOUT_MS)

    const onFinish = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }
    const onFail = (
      _e: unknown,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ): void => {
      // Subframe load failures do not make the whole page unusable.
      if (!isMainFrame) {
        return
      }
      if (settled) {
        return
      }
      settled = true
      cleanup()
      // Redirects and SPA navigations can abort loads with ERR_ABORTED (-3).
      if (errorCode === -3) {
        resolve()
        return
      }
      reject(new Error(`${errorDescription} (${errorCode})`))
    }
    const onDestroyed = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-finish-load', onFinish)
      wc.removeListener('did-fail-load', onFail)
      wc.removeListener('destroyed', onDestroyed)
    }

    wc.on('did-finish-load', onFinish)
    wc.on('did-fail-load', onFail)
    wc.once('destroyed', onDestroyed)
    void wc.loadURL(url).catch(() => {
      // loadURL rejects on aborted navigations; did-fail-load handles the rest.
    })
  })
}

// Detach before destroy: rejected CDP snapshots can call capturePage during teardown and crash Electron 43.7.8.
export function endOffscreenBrowserDebuggerSessions(win: BrowserWindow): void {
  const dbg = win.webContents.debugger
  if (!dbg.isAttached()) {
    return
  }
  try {
    dbg.detach()
  } catch {
    // The page is being destroyed either way; a failed detach must not keep it alive.
  }
}
