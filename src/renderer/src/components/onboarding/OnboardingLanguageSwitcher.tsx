import { useRef, useState } from 'react'
import { ChevronDown, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { translate, loadRendererUiLanguage } from '@/i18n/i18n'
import { getUiLanguageNativeLabel } from '@/i18n/supported-languages'
import { useLanguageReadiness } from '@/i18n/language-readiness'
import { useAppStore } from '@/store'
import {
  SUPPORTED_UI_LOCALES,
  type SupportedUiLocale,
  getRendererLanguageDetection,
  shouldShowLanguageSwitcher
} from '../../../../shared/ui-locale'

export function OnboardingLanguageSwitcher({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const language = useAppStore((state) => state.settings?.uiLanguage ?? 'system')
  const updateSettings = useAppStore((state) => state.updateSettingsOrThrow)
  const catalogError = useLanguageReadiness((state) => state.error)
  const catalogLoading = useLanguageReadiness((state) => state.loading)
  const detection =
    useLanguageReadiness((state) => state.detection) ?? getRendererLanguageDetection()
  const [recoveryVisible] = useState(catalogError)
  const [selectionPhase, setSelectionPhase] = useState<'load' | 'save' | null>(null)
  const [selectionFailure, setSelectionFailure] = useState<{
    language: SupportedUiLocale
    stage: 'load' | 'save'
  } | null>(null)
  const selectionInFlight = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const busy = selectionPhase !== null || catalogLoading
  const chooseLanguage = async (next: SupportedUiLocale): Promise<void> => {
    if (selectionInFlight.current || catalogLoading) {
      return
    }
    selectionInFlight.current = true
    setSelectionPhase('load')
    setSelectionFailure(null)
    let stage: 'load' | 'save' = 'load'
    try {
      await loadRendererUiLanguage(next)
      stage = 'save'
      setSelectionPhase('save')
      await updateSettings({ uiLanguage: next })
      if (useAppStore.getState().settings?.uiLanguage !== next) {
        return
      }
      if (catalogError && language === next) {
        useLanguageReadiness.getState().retryLanguageLoad()
      }
    } catch {
      setSelectionFailure({ language: next, stage })
    } finally {
      selectionInFlight.current = false
      setSelectionPhase(null)
    }
  }

  if (!open && !shouldShowLanguageSwitcher(detection) && !catalogError && !recoveryVisible) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0" lang="en">
          <Globe />
          <span>Switch language</span>
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        aria-label={translate('onboarding.language.title', 'Display language')}
        className="z-[110] w-80 max-w-[calc(100vw-2rem)]"
        wheelScroll
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = contentRef.current
          const selected =
            content?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]') ??
            content?.querySelector<HTMLElement>('[role="radio"]')
          selected?.focus()
        }}
      >
        <div className="scrollbar-sleek max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {translate('onboarding.language.title', 'Display language')}
              </p>
              <p className="text-xs text-muted-foreground">
                {detection.status === 'supported'
                  ? translate('onboarding.language.device', 'System language: {{language}}', {
                      language: getUiLanguageNativeLabel(detection.locale)
                    })
                  : detection.status === 'unsupported'
                    ? translate(
                        'onboarding.language.unsupported',
                        'System language: {{language}}. This language is not supported yet.',
                        { language: detection.detectedTag }
                      )
                    : translate(
                        'onboarding.language.unknown',
                        'Your system language could not be detected. Choose a language below.'
                      )}
              </p>
            </div>
            <RadioGroup
              value={language === 'system' ? detection.locale : language}
              aria-busy={busy}
              aria-disabled={busy}
              onKeyDownCapture={(event) => {
                if (
                  busy &&
                  [
                    'ArrowDown',
                    'ArrowUp',
                    'ArrowLeft',
                    'ArrowRight',
                    'Home',
                    'End',
                    ' ',
                    'Enter'
                  ].includes(event.key)
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
              onValueChange={(value) => {
                const locale = SUPPORTED_UI_LOCALES.find((entry) => entry === value)
                if (locale) {
                  void chooseLanguage(locale)
                }
              }}
              aria-label={translate('onboarding.language.title', 'Display language')}
            >
              {SUPPORTED_UI_LOCALES.map((locale) => (
                <div key={locale} className="rounded-md px-2 py-2 hover:bg-accent">
                  <Label className="cursor-pointer">
                    <RadioGroupItem
                      value={locale}
                      onClick={() => {
                        if (language === 'system' && locale === detection.locale) {
                          void chooseLanguage(locale)
                        }
                      }}
                    />
                    <span>{getUiLanguageNativeLabel(locale)}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p role="status" className="h-4 text-xs text-muted-foreground">
              {selectionPhase === 'save'
                ? translate('onboarding.language.saving', 'Saving language…')
                : busy
                  ? translate('onboarding.language.loading', 'Loading language…')
                  : null}
            </p>
            {(selectionFailure !== null || catalogError) && (
              <div role="alert" className="space-y-2">
                <p className="text-xs text-destructive">
                  {selectionFailure?.stage === 'save'
                    ? translate(
                        'onboarding.language.saveError',
                        'Could not save your language preference. Try again.'
                      )
                    : translate(
                        'onboarding.language.loadError',
                        'Could not load this language. Try again.'
                      )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (selectionFailure) {
                      void chooseLanguage(selectionFailure.language)
                    } else {
                      useLanguageReadiness.getState().retryLanguageLoad()
                    }
                  }}
                >
                  {translate('onboarding.language.retry', 'Retry')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
