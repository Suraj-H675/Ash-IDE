import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle, Clipboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  formatCrashReportText,
  isReactErrorBoundaryReport,
  MAX_USER_NOTES_LENGTH,
  type CrashReportRecord
} from '../../../../shared/crash-reporting'
import { getIntlLocale } from '@/i18n/i18n'
import { useCrashReportCopy } from './use-crash-report-copy'

function crashSummary(report: CrashReportRecord): string {
  if (isReactErrorBoundaryReport(report)) {
    const surface = typeof report.details.surface === 'string' ? report.details.surface : null
    return surface ? `UI rendering error in ${surface}` : 'UI rendering error'
  }
  return `${report.processType} ${report.reason}${
    report.exitCode === null ? '' : ` (exit ${report.exitCode})`
  }`
}

export type CrashReportDialogSurfaceProps = {
  open: boolean
  report: CrashReportRecord | null
  loading: boolean
  onOpenChange: (open: boolean) => void
  onReportChange: (report: CrashReportRecord | null) => void
}

/**
 * Retain local crash history and user-directed copying. The inherited
 * upstream upload service is not an Ash backend; no crash data is sent.
 */
export function CrashReportDialogSurface({
  open,
  report,
  loading,
  onOpenChange,
  onReportChange
}: CrashReportDialogSurfaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [notes, setNotes] = useState('')
  const deferredNotes = useDeferredValue(notes)
  const diagnosticText = useMemo(
    () => (report ? formatCrashReportText(report, deferredNotes) : ''),
    [deferredNotes, report]
  )
  const copyCrashReportDetails = useCrashReportCopy(report, notes)

  const dismissReportIfNeeded = async (): Promise<void> => {
    if (report?.status === 'pending') {
      await window.api.crashReports.dismiss({ reportId: report.id })
      if (mountedRef.current) {
        onReportChange({ ...report, status: 'dismissed' })
      }
    }
  }

  const handleDismiss = async (): Promise<void> => {
    await dismissReportIfNeeded()
    if (mountedRef.current) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void dismissReportIfNeeded().finally(() => {
            if (mountedRef.current) {
              onOpenChange(false)
            }
          })
        } else {
          onOpenChange(true)
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            {report
              ? isReactErrorBoundaryReport(report)
                ? 'Ash IDE encountered a recoverable UI error'
                : 'Ash IDE closed unexpectedly'
              : 'Local crash details'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Crash details stay on this computer. Review and copy the text if you choose to report an
            issue yourself. Ash IDE does not upload crash reports.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          {report ? (
            <>
              <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground">{crashSummary(report)}</div>
                <div className="mt-1 text-muted-foreground">
                  {new Date(report.createdAt).toLocaleString(getIntlLocale())} · {report.platform}{' '}
                  {report.arch} · Ash IDE {report.appVersion}
                </div>
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">Diagnostic text</div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-muted-foreground scrollbar-sleek">
                  {diagnosticText}
                </pre>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              {loading
                ? 'Checking locally saved crash reports…'
                : 'No crash report was captured. You can still copy your notes locally.'}
            </div>
          )}
          <div className="space-y-1">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              maxLength={MAX_USER_NOTES_LENGTH}
              placeholder="Optional: what happened?"
              className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div
              aria-hidden="true"
              className="text-right text-[11px] tabular-nums text-muted-foreground"
            >
              {notes.length.toLocaleString(getIntlLocale())} /{' '}
              {MAX_USER_NOTES_LENGTH.toLocaleString(getIntlLocale())}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyCrashReportDetails()}
            disabled={loading}
          >
            <Clipboard className="size-3.5" />
            Copy details
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleDismiss()}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
