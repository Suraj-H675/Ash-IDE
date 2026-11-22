import type React from 'react'
import { useState } from 'react'
import type {
  CandidatePackageIdentityEvidence,
  UpdatePreflightBlocker,
  UpdatePreflightCount,
  UpdatePreflightReport,
  UpdatePreflightUnknownReason
} from '../../../../../shared/update-preflight-types'
import { Button } from '../../ui/button'
import { SearchableSetting } from '../section-layout/SearchableSetting'

const blockerCopy: Record<UpdatePreflightBlocker, string> = {
  'candidate-not-provided': 'No staged update candidate was supplied to this check.',
  'candidate-identity-unverified': 'The embedded Ash package identity is not verified.',
  'release-signing-unapproved': 'An Ash release signing trust root has not been approved.',
  'exclusive-maintenance-fence-unavailable':
    'Ash cannot place all windows and sessions behind an exclusive maintenance fence.',
  'complete-state-rollback-unavailable':
    'Rollback does not yet cover every compatible app state domain.',
  'host-ownership-unverified': 'Ash cannot prove it is the only runtime owner on this host.',
  'daemon-generation-inventory-unknown': 'The authenticated daemon inventory is incomplete.',
  'window-inventory-unknown': 'The Ash window inventory is incomplete.',
  'gui-window-active': 'An Ash window is open.',
  'pty-inventory-unknown': 'The PTY session inventory is incomplete.',
  'pty-active':
    'A PTY was observed during this check. Confirm it has ended in Manage Sessions; closing its window does not stop it.',
  'agent-owner-inventory-unknown': 'PTY agent ownership could not be fully verified.',
  'agent-session-active':
    'A PTY was observed with an agent owner during this check. Stop it with its provider, then confirm the PTY ended in Manage Sessions.',
  'provider-agent-inventory-unknown':
    'Ash cannot see every provider-native agent session. Review provider sessions before relying on an empty PTY inventory.',
  'pending-disk-writes-unknown':
    'Ash cannot prove that writes are drained. Finish ongoing saves and writes, then recheck; this diagnostic still cannot prove they are clear.'
}

const unknownReasonCopy: Record<UpdatePreflightUnknownReason, string> = {
  'daemon-unavailable': 'The local daemon is unavailable.',
  'daemon-disconnected': 'The local daemon is disconnected.',
  'inventory-partial': 'The daemon inventory was incomplete or changed during this check.',
  'inventory-invalid': 'The daemon returned an invalid inventory.',
  'daemon-identity-changed': 'The daemon identity changed during the check.',
  'provider-changed': 'The active provider changed during the check.',
  'generation-limit-exceeded': 'The check reached its daemon generation limit.',
  'fallback-inventory-unavailable': 'The fallback session inventory is unavailable.',
  'window-inventory-unavailable':
    'The Ash window inventory was unavailable or changed during this check.',
  'provider-agent-inventory-unavailable': 'The provider agent inventory is unavailable.',
  'agent-owner-inventory-incomplete': 'PTY agent ownership is incomplete.',
  'pending-write-census-unavailable': 'The pending disk write census is unavailable.',
  'exclusive-host-ownership-unavailable': 'Exclusive host ownership cannot be established.'
}

function describeCount(
  count: UpdatePreflightCount | { state: 'unknown'; reason: UpdatePreflightUnknownReason }
): string {
  if (count.state === 'known') {
    return String(count.count)
  }
  if ('lowerBound' in count && count.lowerBound > 0) {
    return `At least ${count.lowerBound} observed; ${unknownReasonCopy[count.reason]}`
  }
  return `Unknown; ${unknownReasonCopy[count.reason]}`
}

function describeCandidate(candidate: CandidatePackageIdentityEvidence): string {
  if (candidate.state === 'unavailable') {
    return 'No staged candidate was supplied; no release package was inspected.'
  }
  return `The signed metadata claims version ${candidate.versionClaim}, but the embedded AppImage payload was not inspected.`
}

export function UpdatePreflightDiagnostic(): React.JSX.Element {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<UpdatePreflightReport | null>(null)
  const [failed, setFailed] = useState(false)

  const inspect = async (): Promise<void> => {
    setLoading(true)
    setReport(null)
    setFailed(false)
    try {
      setReport(await window.api.updater.getPreflight())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SearchableSetting
      title="Local update safety"
      description="Read-only inventory of update blockers. This does not check for, download, or install updates."
      keywords={['update', 'preflight', 'runtime', 'blockers', 'sessions', 'safety']}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Ash updates remain unavailable. This diagnostic never stops sessions or changes files.
        </p>
        <Button variant="outline" size="sm" onClick={() => void inspect()} disabled={loading}>
          {loading ? 'Inspecting local activity…' : 'Inspect local update blockers'}
        </Button>
        {loading ? (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            Reading the current local runtime inventory…
          </p>
        ) : null}
        {failed ? (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            The desktop runtime did not return a complete report. Updates remain unavailable.
          </p>
        ) : null}
        {report ? (
          <section aria-label="Local update safety result" className="space-y-3">
            <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
              Local update safety inspection complete. Admission: {report.decision}. Activation is
              unavailable.
            </p>
            <p className="text-xs text-muted-foreground">
              Snapshot observed {new Date(report.runtime.observedAtMs).toLocaleString()}.
            </p>
            <div className="space-y-3 rounded-md border border-border/60 p-3 text-xs">
              <div>
                <h3 className="font-medium">Admission: {report.decision}</h3>
                <p className="text-muted-foreground">Activation is unavailable.</p>
                <p className="text-muted-foreground">
                  {describeCandidate(report.candidateIdentity)}
                </p>
              </div>
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Daemon generations</dt>
                  <dd>{describeCount(report.runtime.daemonGenerations)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ash windows</dt>
                  <dd>{describeCount(report.runtime.windows)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">PTY sessions</dt>
                  <dd>{describeCount(report.runtime.ptys)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">PTY-owned agent sessions</dt>
                  <dd>{describeCount(report.runtime.ptyOwnedAgentSessions)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Provider agent sessions</dt>
                  <dd>{describeCount(report.runtime.providerAgentSessions)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pending disk writes</dt>
                  <dd>{describeCount(report.runtime.pendingDiskWrites)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Exclusive host ownership</dt>
                  <dd>{unknownReasonCopy[report.runtime.hostOwnership.reason]}</dd>
                </div>
              </dl>
              <div>
                <h4 className="font-medium">Blockers</h4>
                {report.blockers.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {report.blockers.map((blocker) => (
                      <li key={blocker}>{blockerCopy[blocker]}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    No blocker details were returned. Updates remain unavailable.
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </SearchableSetting>
  )
}
