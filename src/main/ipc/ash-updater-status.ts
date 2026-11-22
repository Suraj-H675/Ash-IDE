import { app, BrowserWindow, ipcMain } from 'electron'
import { NO_STAGED_UPDATE_CANDIDATE, assessUpdatePreflight } from '../updater/update-preflight'
import { collectAshUpdateRuntimeCensus } from '../updater/update-runtime-ash-census'
import type { UpdatePreflightReport } from '../../shared/update-preflight-types'
import type { UpdateStatus } from '../../shared/update-status-types'
import type { Store } from '../persistence/loading-store/store'
import { getTrustedUIRendererWebContents } from './ui'

export function registerAshUpdaterReadOnlyHandlers(
  store: Pick<Store, 'hasObservedPendingLocalWrite'>
): void {
  const assertTrustedSender = (event: { sender: unknown }) => {
    if (getTrustedUIRendererWebContents() !== event.sender) {
      throw new Error('Unauthorized Ash updater status sender')
    }
  }

  ipcMain.handle('updater:getStatus', (event): UpdateStatus => {
    assertTrustedSender(event)
    return {
      state: 'unavailable',
      reason: app.isPackaged ? 'not-configured' : 'source-build'
    }
  })

  ipcMain.handle('updater:getVersion', (event): string => {
    assertTrustedSender(event)
    return app.getVersion()
  })

  ipcMain.handle('updater:getPreflight', async (event): Promise<UpdatePreflightReport> => {
    assertTrustedSender(event)
    const runtime = await collectAshUpdateRuntimeCensus(
      () => BrowserWindow.getAllWindows().length,
      () => store.hasObservedPendingLocalWrite()
    )
    return assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, runtime)
  })
}
