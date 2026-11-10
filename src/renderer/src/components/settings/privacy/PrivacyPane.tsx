import { ShieldCheck } from 'lucide-react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { PrivacyDiagnosticsSection } from './PrivacyDiagnosticsSection'

type PrivacyPaneProps = {
  settings: GlobalSettings
}

/** Product analytics are excluded from Ash. Only local, user-triggered diagnostics remain. */
export function PrivacyPane(_props: PrivacyPaneProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 py-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <div>
          <h3 className="text-sm font-medium">Local-first privacy</h3>
          <p className="text-xs text-muted-foreground">
            Ash IDE does not transmit product analytics or upload diagnostic reports. You can review
            locally collected diagnostics below and decide what to share outside the app. Your
            coding providers have their own account and network policies.
          </p>
        </div>
      </div>
      <PrivacyDiagnosticsSection />
    </div>
  )
}
