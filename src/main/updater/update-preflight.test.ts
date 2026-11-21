import { describe, expect, it } from 'vitest'
import type { UpdateRuntimeCensus } from '../../shared/update-preflight-types'
import { NO_STAGED_UPDATE_CANDIDATE, assessUpdatePreflight } from './update-preflight'

function census(overrides: Partial<UpdateRuntimeCensus> = {}): UpdateRuntimeCensus {
  return {
    observedAtMs: 1_800_000_000_000,
    hostOwnership: { state: 'unknown', reason: 'exclusive-host-ownership-unavailable' },
    daemonGenerations: { state: 'known', count: 1 },
    windows: { state: 'known', count: 0 },
    ptys: { state: 'known', count: 0 },
    ptyOwnedAgentSessions: { state: 'known', count: 0 },
    providerAgentSessions: {
      state: 'unknown',
      reason: 'provider-agent-inventory-unavailable'
    },
    pendingDiskWrites: {
      state: 'unknown',
      reason: 'pending-write-census-unavailable'
    },
    ...overrides
  }
}

describe('safe update preflight decision', () => {
  it('defers even when visible windows and PTYs are empty', () => {
    const report = assessUpdatePreflight(NO_STAGED_UPDATE_CANDIDATE, census())

    expect(report.decision).toBe('defer')
    expect(report.activationAvailable).toBe(false)
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'candidate-not-provided',
        'release-signing-unapproved',
        'exclusive-maintenance-fence-unavailable',
        'complete-state-rollback-unavailable',
        'provider-agent-inventory-unknown',
        'pending-disk-writes-unknown'
      ])
    )
    expect(report.blockers).not.toContain('candidate-identity-unverified')
  })

  it('marks a supplied signed package claim as unverified', () => {
    const report = assessUpdatePreflight(
      {
        state: 'unverified',
        source: 'signed-manifest-claim',
        appIdClaim: 'com.ashide.desktop',
        productNameClaim: null,
        versionClaim: '0.2.0',
        architectureClaim: 'x64',
        artifactSha256: 'a'.repeat(64),
        artifactSha256Verified: true,
        reason: 'embedded-appimage-payload-not-inspected'
      },
      census()
    )

    expect(report.blockers).toContain('candidate-identity-unverified')
    expect(report.blockers).not.toContain('candidate-not-provided')
  })

  it('reports every known active resource as busy', () => {
    const report = assessUpdatePreflight(
      NO_STAGED_UPDATE_CANDIDATE,
      census({
        windows: { state: 'known', count: 2 },
        ptys: { state: 'known', count: 3 },
        ptyOwnedAgentSessions: { state: 'known', count: 1 }
      })
    )

    expect(report.decision).toBe('busy')
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'gui-window-active',
        'pty-active',
        'agent-session-active',
        'pending-disk-writes-unknown'
      ])
    )
  })

  it('keeps unreachable and partial evidence unknown instead of empty', () => {
    const report = assessUpdatePreflight(
      NO_STAGED_UPDATE_CANDIDATE,
      census({
        hostOwnership: { state: 'unknown', reason: 'exclusive-host-ownership-unavailable' },
        daemonGenerations: { state: 'unknown', reason: 'daemon-disconnected' },
        ptys: { state: 'unknown', reason: 'inventory-partial' },
        ptyOwnedAgentSessions: {
          state: 'unknown',
          reason: 'agent-owner-inventory-incomplete'
        }
      })
    )

    expect(report.decision).toBe('defer')
    expect(report.runtime.daemonGenerations).toEqual({
      state: 'unknown',
      reason: 'daemon-disconnected'
    })
    expect(report.runtime.ptys).toEqual({ state: 'unknown', reason: 'inventory-partial' })
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'host-ownership-unverified',
        'daemon-generation-inventory-unknown',
        'pty-inventory-unknown',
        'agent-owner-inventory-unknown'
      ])
    )
  })
})
