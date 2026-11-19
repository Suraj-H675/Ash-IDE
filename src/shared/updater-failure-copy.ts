// One English table for updater failures: main builds the English `message`, the renderer translates by code.
export const UPDATER_FAILURE_COPY = {
  releaseNotReady: "A newer release isn't available for this device yet. Check again later.",
  updateServerUnreachable: "Couldn't reach the update server. Try again in a few minutes.",
  channelUnsupportedPlatform: '{{channel}} builds are produced only for macOS and Windows.',
  unsignedDevChannel:
    '{{channel}} builds are unsigned, and this signed build only installs updates signed by the Ash IDE publisher. Download the installer from the release page and run it once — updates work normally from there, including back to Stable.',
  linuxPackageMissing:
    'The downloaded package is no longer in the update cache. Download the update again, or get it from the official release page.',
  linuxPackageNotRegular:
    'The downloaded package is no longer a valid file in the update cache. Download the update again, or get it from the official release page.',
  linuxPackageHashMismatch:
    'The downloaded package no longer matches the verified release, so Ash IDE will not hand it to a package manager. Download the update again, or get it from the official release page.',
  linuxPackageReadFailed:
    'Ash IDE could not read the downloaded package. Download the update again, or get it from the official release page.',
  linuxPackageNoSudo:
    'No sudo command was found in the system directories, so Ash IDE cannot build a safe install command. Show the package and install it with your package manager.',
  linuxPackageNoPackageManager:
    'No supported package manager was found in the system directories, so Ash IDE cannot build a safe install command. Show the package and install it with your package manager.',
  linuxPackageInvalidPath:
    'The downloaded package is not at a usable path, so Ash IDE cannot build a safe install command. Show the package and install it with your package manager.',
  linuxPackageMarkerUnusable:
    'Ash IDE could not verify the installed Linux package format, so it will not install this update automatically. Download the update from the official release page and install it manually.',
  linuxPackageExternallyManaged:
    'This copy of Ash IDE is managed by your system package manager, so Ash IDE cannot install updates itself. Update Ash IDE through your distribution instead.',
  linuxPackageManualInstall: 'Quit Ash IDE before running the system package install command.',
  linuxPackageMetadataUnusable:
    'The downloaded package metadata could not be verified. Quit Ash IDE before downloading and installing the update from the official release page.',
  unknownReleaseChannel: 'Unknown release channel "{{channel}}".',
  invalidReleaseTag: '"{{tag}}" is not a valid release tag.',
  releaseRepoNotFound: 'No releases repository found at {{repo}}.',
  releaseListFailed: 'Could not list {{channel}} builds (HTTP {{status}}).',
  releaseListUnreadable: 'Could not read the {{channel}} release list.',
  rateLimitedSoon: 'GitHub rate limit reached. Try again in a few minutes.',
  rateLimitedSoonSignedOut: 'GitHub rate limit reached. Try again in a few minutes.',
  rateLimitedInMinute: 'GitHub rate limit reached. Try again in about a minute.',
  rateLimitedInMinuteSignedOut: 'GitHub rate limit reached. Try again in about a minute.',
  // Only for two or more minutes; one minute uses rateLimitedInMinute.
  rateLimitedInMinutes: 'GitHub rate limit reached. Try again in about {{count}} minutes.',
  rateLimitedInMinutesSignedOut: 'GitHub rate limit reached. Try again in about {{count}} minutes.'
} as const

export type UpdaterFailureCode = keyof typeof UPDATER_FAILURE_COPY

export type UpdaterFailureParams = Record<string, string | number>

/** Wire shape: `message` stays English for older readers; code and params let the renderer translate it. */
export type UpdaterCodedMessage = {
  message: string
  messageCode?: string
  messageParams?: UpdaterFailureParams
}

// One pass, so a value containing "{{status}}" stays verbatim.
export function updaterFailureText(
  code: UpdaterFailureCode,
  params: UpdaterFailureParams = {}
): string {
  return UPDATER_FAILURE_COPY[code].replace(/\{\{(\w+)\}\}/g, (slot, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : slot
  )
}

export function updaterCodedMessage(
  code: UpdaterFailureCode,
  params?: UpdaterFailureParams
): UpdaterCodedMessage {
  return {
    message: updaterFailureText(code, params),
    messageCode: code,
    ...(params ? { messageParams: params } : {})
  }
}
