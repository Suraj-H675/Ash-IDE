import { translate } from '@/i18n/i18n'
import { SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'

const TITLE = 'auto.components.settings.shareSkills.showButton'
const DESCRIPTION = 'auto.components.settings.shareSkills.showButtonDescription'

export function ShowSkillsShortcutSetting({
  enabled,
  onChange
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}): React.JSX.Element {
  const label = translate(TITLE, 'Show Skills button')
  const description = translate(DESCRIPTION, 'Show the Skills shortcut in the sidebar.')

  return (
    <SearchableSetting
      title={label}
      description={description}
      keywords={['skills', 'sidebar', 'shortcut', 'navigation']}
    >
      <SettingsSwitchRow
        label={label}
        description={description}
        checked={enabled}
        onChange={() => onChange(!enabled)}
      />
    </SearchableSetting>
  )
}
