import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
import type {
  DiagnosticsBundlePayload,
  DiagnosticsStatusPayload
} from '../../../../../preload/api/telemetry-api'
import { Label } from '../../ui/label'
import { Separator } from '../../ui/separator'
import {
  getDiagnosticBundleDescription,
  PrivacyDiagnosticBundleControls
} from './PrivacyDiagnosticBundleControls'
import { diagnosticsErrorText } from './diagnostics-bundle-error-copy'

/**
 * User-initiated local diagnostic files only. Do not present or invoke inherited
 * upload, remote ticket/deletion, or cloud support controls.
 */
export function PrivacyDiagnosticsSection(): React.JSX.Element {
  const [status, setStatus] = useState<DiagnosticsStatusPayload | null>(null)
  const [bundle, setBundle] = useState<DiagnosticsBundlePayload | null>(null)
  const [previewOpened, setPreviewOpened] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [openingPreview, setOpeningPreview] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const mountedRef = useRef(true)
  const activeBundleSubmissionIdRef = useRef<string | null>(null)

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.diagnostics.getStatus()
      if (mountedRef.current) {
        setStatus(next)
      }
    } catch {
      // Keep local creation disabled if the status cannot be checked.
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (activeBundleSubmissionIdRef.current) {
        void window.api.diagnostics.discardBundlePreview(activeBundleSubmissionIdRef.current)
      }
    }
  }, [])

  const handleCollectBundle = useCallback(async (): Promise<void> => {
    setCollecting(true)
    try {
      const nextBundle = await window.api.diagnostics.collectBundle()
      if (!mountedRef.current) {
        await window.api.diagnostics.discardBundlePreview(nextBundle.bundleSubmissionId)
        return
      }
      activeBundleSubmissionIdRef.current = nextBundle.bundleSubmissionId
      setBundle(nextBundle)
      setPreviewOpened(false)
      toast.success('Local diagnostic file created')
    } catch (error) {
      if (mountedRef.current) {
        toast.error(diagnosticsErrorText(error, 'Could not create local diagnostic file'))
      }
    } finally {
      if (mountedRef.current) {
        setCollecting(false)
      }
    }
  }, [])

  const handleOpenPreview = useCallback(async (): Promise<void> => {
    if (!bundle) {
      return
    }
    setOpeningPreview(true)
    try {
      await window.api.diagnostics.openBundlePreview(bundle.bundleSubmissionId)
      if (!mountedRef.current) {
        return
      }
      setPreviewOpened(true)
      toast.success('Local diagnostic review file opened')
    } catch (error) {
      if (mountedRef.current) {
        toast.error(diagnosticsErrorText(error, 'Could not open local review file'))
      }
    } finally {
      if (mountedRef.current) {
        setOpeningPreview(false)
      }
    }
  }, [bundle])

  const handleDiscardBundle = useCallback(async (): Promise<void> => {
    if (!bundle) {
      return
    }
    setDiscarding(true)
    try {
      await window.api.diagnostics.discardBundlePreview(bundle.bundleSubmissionId)
      if (!mountedRef.current) {
        return
      }
      activeBundleSubmissionIdRef.current = null
      setBundle(null)
      setPreviewOpened(false)
      toast.success('Local diagnostic review file discarded')
    } catch (error) {
      if (mountedRef.current) {
        toast.error(diagnosticsErrorText(error, 'Could not discard local review file'))
      }
    } finally {
      if (mountedRef.current) {
        setDiscarding(false)
      }
    }
  }, [bundle])

  return (
    <>
      {status?.disabledReason ? (
        <p className="text-xs text-muted-foreground">
          Local diagnostic collection is disabled by the current environment (
          {status.disabledReason}).
        </p>
      ) : null}
      <Separator />
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <FileText className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <Label className="text-sm">Local app diagnostics</Label>
            <p className="text-xs text-muted-foreground">
              {getDiagnosticBundleDescription({ bundle, previewOpened })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <PrivacyDiagnosticBundleControls
            status={status}
            bundle={bundle}
            collecting={collecting}
            openingPreview={openingPreview}
            discarding={discarding}
            onCollect={handleCollectBundle}
            onOpenPreview={handleOpenPreview}
            onDiscard={handleDiscardBundle}
          />
        </div>
      </div>
    </>
  )
}
