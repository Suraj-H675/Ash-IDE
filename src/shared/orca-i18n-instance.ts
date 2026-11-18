import i18next, {
  type i18n as I18nInstance,
  type InitOptions,
  type Module,
  type TOptions
} from 'i18next'
import { isPseudoLocalizationLocale, pseudoLocalizeString } from './pseudo-localization'
import { DEFAULT_UI_LOCALE } from './ui-locale'

export type OrcaI18n = {
  i18n: I18nInstance
  translate: (key: string, fallback: string, options?: TOptions) => string
}

const ENGLISH_PLURAL_RULES = new Intl.PluralRules(DEFAULT_UI_LOCALE)

/** Main and renderer share the English resource and fallback behavior. */
export function createOrcaI18n(options: {
  englishResources: Record<string, unknown>
  modules?: Module[]
  initOptions?: InitOptions
}): OrcaI18n {
  const i18n = i18next.createInstance()
  for (const module of options.modules ?? []) {
    i18n.use(module)
  }
  // In-memory resources make init synchronous, so callers can translate at module load.
  void i18n.init({
    fallbackLng: DEFAULT_UI_LOCALE,
    lng: DEFAULT_UI_LOCALE,
    resources: { [DEFAULT_UI_LOCALE]: { translation: options.englishResources } },
    // An empty catalog value falls back to English instead of rendering blank.
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    ...options.initOptions
  })

  return {
    i18n,
    translate: (key, fallback, translateOptions) => {
      const { defaultValue_one: one, count, ...others } = translateOptions ?? {}
      // A pass-through `count: undefined` must interpolate like an absent count.
      const rest = count === undefined ? others : { ...others, count }
      // i18next would pick the English default by the active language's rule (ru 21 -> _one); English text needs English's.
      const defaultValue =
        typeof one === 'string' &&
        typeof count === 'number' &&
        ENGLISH_PLURAL_RULES.select(count) === 'one'
          ? one
          : fallback
      const value = i18n.t(key, { defaultValue, ...rest })
      return isPseudoLocalizationLocale(i18n.language) ? pseudoLocalizeString(value) : value
    }
  }
}
