import { Eye, FileText, Loader2, X } from 'lucide-react'
import type {
  DiagnosticsBundlePayload,
  DiagnosticsStatusPayload
} from '../../../../../preload/api/telemetry-api'
import { Button } from '../../ui/button'

/** Local bundle review only. Ash does not own an external diagnostics upload backend. */
export function PrivacyDiagnosticBundleControls({
  status,
  bundle,
  collecting,
  openingPreview,
  discarding,
  onCollect,
  onOpenPreview,
  onDiscard
}: {
  readonly status: DiagnosticsStatusPayload | null
  readonly bundle: DiagnosticsBundlePayload | null
  readonly collecting: boolean
  readonly openingPreview: boolean
  readonly discarding: boolean
  readonly onCollect: () => Promise<void>
  readonly onOpenPreview: () => Promise<void>
  readonly onDiscard: () => Promise<void>
}): React.JSX.Element {
  if (bundle) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={openingPreview}
          onClick={() => void onOpenPreview()}
        >
          <ActionIcon busy={openingPreview} icon={<Eye className="size-3.5" />} />
          Open local review file
        </Button>
        <Button variant="ghost" size="sm" disabled={discarding} onClick={() => void onDiscard()}>
          <ActionIcon busy={discarding} icon={<X className="size-3.5" />} />
          Discard
        </Button>
      </>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!status?.bundleEnabled || collecting}
      onClick={() => void onCollect()}
    >
      <ActionIcon busy={collecting} icon={<FileText className="size-3.5" />} />
      Create local diagnostic file
    </Button>
  )
}

export function getDiagnosticBundleDescription({
  bundle,
  previewOpened
}: {
  readonly bundle: DiagnosticsBundlePayload | null
  readonly previewOpened: boolean
}): string {
  if (bundle) {
    const size = formatBytes(bundle.bytes)
    return previewOpened
      ? `Local review file opened (${size}). Review it and decide independently what to share, or discard it.`
      : `Local diagnostic file ready (${size}). Open it for review or discard it; Ash IDE will not upload it.`
  }
  return 'Create a redacted local diagnostic file for your review. Nothing is uploaded by Ash IDE. Review it before sharing outside the app; sensitive details may remain.'
}

function ActionIcon({ busy, icon }: { readonly busy: boolean; readonly icon: React.ReactNode }) {
  return busy ? <Loader2 className="size-3.5 animate-spin" /> : icon
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
