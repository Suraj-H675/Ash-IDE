import { app, dialog, Notification } from 'electron'
import { prepareEarlyMainUiLanguage, translateMain } from '../i18n/main-i18n'
import { formatProfileStateStartupFailure } from '../persistence/profile-state/profile-state-startup-failure'
import { isBackgroundLaunch } from '../window/foreground-activation-policy'
import { mainProcessState as state } from './main-process-state'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from './single-instance-lock'
import { acquireDesktopProfileInstanceLock } from './desktop-profile-instance-lock'

/** Never admit a desktop writer unless the shared process lock was actually acquired. */
export function acquireDesktopProfileLockOrExplain(userDataPath: string): boolean {
  const profileLock = acquireDesktopProfileInstanceLock(userDataPath, undefined, undefined, () => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Ash IDE stopped to protect your profile',
        body: 'Another process took ownership of this profile. Close the other runtime before reopening Ash IDE; review unsaved changes after recovery.'
      }).show()
    }
  })
  if (profileLock.state === 'acquired') {
    return true
  }
  handleMainProcessPreflightFailure(
    new Error(profileLock.message),
    profileLock.state === 'held' ? SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE : 1
  )
  return false
}

/** Ends a failed preflight without showing a Linux dialog before Electron is ready. */
export function handleMainProcessPreflightFailure(error: unknown, exitCode = 1): void {
  const shouldShowDialog = !state.isServeMode && !isBackgroundLaunch()
  state.desktopActivationGate = null
  const admission = state.profileStateAdmission
  state.profileStateAdmission = undefined
  try {
    admission?.release()
  } catch (releaseError) {
    console.warn('[startup] Could not release profile state admission:', releaseError)
  }

  const showDialogAndExit = (): void => {
    try {
      // Build after Electron is ready so this dialog uses the same English resources as other startup surfaces.
      const message =
        formatProfileStateStartupFailure(error, translateMain) ??
        (error instanceof Error ? error.message : String(error))
      dialog.showErrorBox(translateMain('startupFailure.title', 'Orca could not start'), message)
    } catch (dialogError) {
      console.warn('[startup] Could not show startup failure:', dialogError)
    } finally {
      app.exit(exitCode)
    }
  }
  if (process.platform === 'linux' && shouldShowDialog) {
    try {
      void app
        .whenReady()
        .then(prepareEarlyMainUiLanguage)
        .then(showDialogAndExit, () => app.exit(exitCode))
    } catch {
      app.exit(exitCode)
    }
  } else if (shouldShowDialog) {
    // Why: pre-ready exit must stay synchronous, so this can't await the lazily loaded catalog.
    showDialogAndExit()
  } else {
    app.exit(exitCode)
  }
}
