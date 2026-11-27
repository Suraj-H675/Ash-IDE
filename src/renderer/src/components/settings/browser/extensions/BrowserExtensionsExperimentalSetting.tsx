import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import type { BrowserExtensionSupportStatus } from '../../../../../../shared/browser/extensions/browser-extension-types'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { Label } from '../../../ui/label'
import { Button } from '../../../ui/button'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { SettingsSwitch } from '../../form-controls/SettingsFormControls'
import { getExperimentalSearchEntry } from '../../advanced/experimental-search'

type BrowserExtensionsExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserExtensionsExperimentalSetting({
  settings,
  updateSettings
}: BrowserExtensionsExperimentalSettingProps): React.JSX.Element {
  const entry = getExperimentalSearchEntry().browserExtensions
  const enabled = settings.experimentalBrowserExtensions === true
  const [supportStatus, setSupportStatus] = useState<BrowserExtensionSupportStatus | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (isWebClientLocation()) {
      return
    }
    const unsubscribe = window.api.browser.onExtensionsSupportStatusChanged(setSupportStatus)
    void window.api.browser
      .extensionsSupportStatus()
      .then((status) => {
        if (status) {
          setSupportStatus(status)
        }
      })
      .catch(() => {})
    return unsubscribe
  }, [])

  async function retryTransition(): Promise<void> {
    setRetrying(true)
    try {
      const status = await window.api.browser.extensionsRetrySupportTransition()
      if (status) {
        setSupportStatus(status)
      }
    } catch {
      // The status event reports whether native recovery completed.
    } finally {
      setRetrying(false)
    }
  }

  const recoveryNotice = (() => {
    switch (supportStatus?.runtime) {
      case 'enabling':
        return (
          <p role="status" className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.browserExtensions.enabling',
              'Enabling browser extensions for open profiles.'
            )}
          </p>
        )
      case 'disabling':
        return (
          <p role="status" className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.browserExtensions.disabling',
              'Disabling browser extensions. Waiting for active changes and native unload to finish.'
            )}
          </p>
        )
      case 'unload-failed':
        return (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>
              {translate(
                'auto.components.settings.ExperimentalPane.browserExtensions.unloadFailed',
                'Chromium did not confirm that extensions stopped. Their scripts may still run, and Ash cannot stop scripts that Chromium keeps loaded.'
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={retrying}
              onClick={retryTransition}
            >
              {retrying
                ? translate(
                    'auto.components.settings.ExperimentalPane.browserExtensions.retrying',
                    'Retrying…'
                  )
                : translate(
                    supportStatus.desiredEnabled
                      ? 'auto.components.settings.ExperimentalPane.browserExtensions.retryEnableAfterCleanup'
                      : 'auto.components.settings.ExperimentalPane.browserExtensions.retryDisable',
                    supportStatus.desiredEnabled ? 'Retry cleanup and enable' : 'Retry disabling'
                  )}
            </Button>
          </div>
        )
      case 'enable-failed':
        return (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>
              {translate(
                'auto.components.settings.ExperimentalPane.browserExtensions.enableFailed',
                'Browser extensions could not be enabled. Retry to recover the runtime.'
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={retrying}
              onClick={retryTransition}
            >
              {retrying
                ? translate(
                    'auto.components.settings.ExperimentalPane.browserExtensions.retrying',
                    'Retrying…'
                  )
                : translate(
                    'auto.components.settings.ExperimentalPane.browserExtensions.retryEnable',
                    'Retry enabling'
                  )}
            </Button>
          </div>
        )
      default:
        return null
    }
  })()

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-browser-extensions"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{entry.title}</Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.browserExtensions.copy',
              'Adds Settings › Browser › Extensions for local browser profiles.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.ExperimentalPane.browserExtensions.toggleLabel',
            'Toggle browser extensions'
          )}
          onChange={() => updateSettings({ experimentalBrowserExtensions: !enabled })}
        />
      </div>
      {enabled && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.ExperimentalPane.browserExtensions.optionalHostUnavailable',
            'Optional website access requested at runtime is not supported yet. Extensions that require it may not work fully.'
          )}
        </p>
      )}
      {recoveryNotice}
    </SearchableSetting>
  )
}
