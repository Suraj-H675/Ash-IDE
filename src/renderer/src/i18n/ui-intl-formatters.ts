import { getIntlLocale } from './i18n'

type CachedFormatter<T> = { locale: string; formatter: T }
type FormatterOptions = Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | Intl.CollatorOptions

const dateTimeFormats = new WeakMap<FormatterOptions, CachedFormatter<Intl.DateTimeFormat>>()
const numberFormats = new WeakMap<FormatterOptions, CachedFormatter<Intl.NumberFormat>>()
const collators = new WeakMap<FormatterOptions, CachedFormatter<Intl.Collator>>()

// Cache by options identity and the fixed UI locale so callers can reuse formatter instances.
function cachedFormatter<T>(
  cache: WeakMap<FormatterOptions, CachedFormatter<T>>,
  options: FormatterOptions,
  create: (locale: string) => T
): T {
  const locale = getIntlLocale()
  const cached = cache.get(options)
  if (cached?.locale === locale) {
    return cached.formatter
  }
  const formatter = create(locale)
  cache.set(options, { locale, formatter })
  return formatter
}

export function uiDateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cachedFormatter(
    dateTimeFormats,
    options,
    (locale) => new Intl.DateTimeFormat(locale, options)
  )
}

export function uiNumberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cachedFormatter(numberFormats, options, (locale) => new Intl.NumberFormat(locale, options))
}

export function uiCollator(options: Intl.CollatorOptions): Intl.Collator {
  return cachedFormatter(collators, options, (locale) => new Intl.Collator(locale, options))
}
