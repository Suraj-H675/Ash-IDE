import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'

function resolveThemeSummary(theme: GlobalSettings['theme']): string {
  if (theme === 'system') {
    return translate('auto.components.settings.AppearancePane.fb0e0b4453', 'System')
  }
  if (theme === 'light') {
    return translate('auto.components.settings.AppearancePane.fd89b5487c', 'Light')
  }
  return translate('auto.components.settings.AppearancePane.7d26ccabe8', 'Dark')
}

export function resolveInterfaceSectionSummary(settings: GlobalSettings): string {
  const fontSummary =
    settings.appFontFamily ||
    translate('auto.components.settings.AppearancePane.interfaceDefaultFont', 'Default font')
  return `${resolveThemeSummary(settings.theme)} · ${fontSummary}`
}
