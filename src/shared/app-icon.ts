export const APP_ICON_OPTIONS = [{ id: 'ash', label: 'Ash' }] as const

export type AppIconId = 'ash'

export const DEFAULT_APP_ICON_ID: AppIconId = 'ash'

export function normalizeAppIconId(_value: unknown): AppIconId {
  return DEFAULT_APP_ICON_ID
}
