import { useLayoutEffect, type ReactNode } from 'react'
import { i18n } from './i18n'
import { useLanguageReadiness } from './language-readiness'

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  useLayoutEffect(() => {
    let cancelled = false
    if (i18n.language === 'en') {
      useLanguageReadiness.setState({ ready: true })
    } else {
      useLanguageReadiness.setState({ ready: false })
      void i18n
        .changeLanguage('en')
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            useLanguageReadiness.setState({ ready: true })
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [])

  // Render the existing app-shell readiness surface while English is selected.
  // initReactI18next already binds useTranslation to this instance.
  return <>{children}</>
}
