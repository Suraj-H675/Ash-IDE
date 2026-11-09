import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isVerifiedClaudeManagedAccountProfile,
  verifyClaudeManagedAccountProfileWithMarkerIdentity,
  type VerifiedClaudeManagedAccountProfile
} from '../../claude-accounts/claude-managed-account-identity'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  prepareClaudeProfileDirectory
} from '../../claude-accounts/claude-profile-paths'
import { canAshWriteProviderGlobalHooks } from '../ash-hook-ownership-policy'
import { makePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import {
  ClaudeHostLaunchCorrelationConsistency,
  type ClaudeHostLaunchCorrelationCandidate,
  type ClaudeHostLaunchCorrelationIssue,
  type ClaudeHostPtySnapshot,
  type ClaudeSessionStartObservation
} from './claude-host-launch-correlation-consistency'

const PLATFORM = process.platform === 'darwin' ? 'darwin' : 'linux'
const TAB_ID = 'terminal-tab'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)
const WORKTREE_ID = 'repo::/worktree'
const PTY_ID = 'pty-local-1'
const INCARNATION_ID = 'pty-incarnation-1'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_SESSION_ID = '33333333-3333-4333-8333-333333333333'

let profileFixtureRoot = ''
let managedAccountA: VerifiedClaudeManagedAccountProfile | undefined
let managedAccountB: VerifiedClaudeManagedAccountProfile | undefined
let managedProfileA: ReturnType<typeof describeClaudeProfile> | undefined

type CandidateOverrides = Partial<
  Omit<ClaudeHostLaunchCorrelationCandidate, 'accountSelection' | 'pty' | 'session'>
> & {
  accountSelection?: ClaudeHostLaunchCorrelationCandidate['accountSelection']
  pty?: Partial<ClaudeHostLaunchCorrelationCandidate['pty']>
  session?: ClaudeHostLaunchCorrelationCandidate['session']
}

function candidate(overrides: CandidateOverrides = {}): ClaudeHostLaunchCorrelationCandidate {
  return {
    platform: PLATFORM,
    runtime: 'host',
    executionHostId: 'local',
    connectionId: null,
    isWsl: false,
    accountSelection: { kind: 'managed', accountId: 'claude-managed-a' },
    accountVerification: managedAccountA!,
    paneKey: PANE_KEY,
    tabId: TAB_ID,
    worktreeId: WORKTREE_ID,
    session: { kind: 'fresh' },
    ...overrides,
    pty: {
      id: PTY_ID,
      incarnationId: INCARNATION_ID,
      running: true,
      ...overrides.pty
    }
  }
}

function currentPty(overrides: Partial<ClaudeHostPtySnapshot> = {}): ClaudeHostPtySnapshot {
  return {
    ptyId: PTY_ID,
    incarnationId: INCARNATION_ID,
    paneKey: PANE_KEY,
    worktreeId: WORKTREE_ID,
    executionHostId: 'local',
    connectionId: null,
    isWsl: false,
    running: true,
    ...overrides
  }
}

function sessionStart(
  overrides: Partial<ClaudeSessionStartObservation> = {}
): ClaudeSessionStartObservation {
  return {
    provider: 'claude',
    eventName: 'SessionStart',
    sessionStartSource: 'startup',
    sessionId: SESSION_ID,
    isFork: false,
    isRemote: false,
    isWsl: false,
    isReplay: false,
    paneKey: PANE_KEY,
    worktreeId: WORKTREE_ID,
    executionHostId: 'local',
    connectionId: null,
    rootAdmission: 'root',
    ...overrides
  }
}

function issued(
  machine = new ClaudeHostLaunchCorrelationConsistency(),
  launch: ClaudeHostLaunchCorrelationCandidate = candidate()
): {
  machine: ClaudeHostLaunchCorrelationConsistency
  issue: Extract<ClaudeHostLaunchCorrelationIssue, { status: 'issued' }>
} {
  const result = machine.issue(launch)
  expect(result).toMatchObject({ kind: 'consistency-only', status: 'issued' })
  return {
    machine,
    issue: result as Extract<ClaudeHostLaunchCorrelationIssue, { status: 'issued' }>
  }
}

describe.skipIf(process.platform === 'win32')(
  'dormant Claude host launch correlation contract',
  () => {
    beforeAll(async () => {
      profileFixtureRoot = mkdtempSync(join(realpathSync(tmpdir()), 'ash-correlation-profile-'))
      const dataRoot = join(profileFixtureRoot, 'ash-private')
      mkdirSync(dataRoot, { mode: 0o700 })
      const verifyAccount = async (accountId: string) => {
        const profile = describeClaudeProfile(dataRoot, accountId, {
          executionHostId: 'local',
          runtime: 'host'
        })
        prepareClaudeProfileDirectory(dataRoot, profile, join(profileFixtureRoot, 'user-home'))()
        return {
          profile,
          verification: await verifyClaudeManagedAccountProfileWithMarkerIdentity(dataRoot, profile)
        }
      }
      const accountA = await verifyAccount('claude-managed-a')
      const accountB = await verifyAccount('claude-managed-b')
      managedProfileA = accountA.profile
      managedAccountA = accountA.verification
      managedAccountB = accountB.verification
    })

    afterAll(() => {
      if (profileFixtureRoot) {
        rmSync(profileFixtureRoot, { force: true, recursive: true })
      }
    })

    it('issues a fresh token hash and accepts only the first root SessionStart UUID', () => {
      const { machine, issue } = issued()

      expect(issue.launchToken).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
      )
      expect(issue.launchTokenHash).toBe(
        createHash('sha256').update(issue.launchToken).digest('hex')
      )
      expect(issue.snapshot).toMatchObject({
        accountId: 'claude-managed-a',
        paneKey: PANE_KEY,
        worktreeId: WORKTREE_ID,
        ptyId: PTY_ID,
        incarnationId: INCARNATION_ID
      })
      expect(Object.isFrozen(issue.snapshot)).toBe(true)
      expect(Object.isFrozen(issue.snapshot.accountIdentity)).toBe(true)

      expect(machine.observeSessionStart(issue.launchToken, sessionStart(), currentPty())).toEqual({
        kind: 'consistency-only',
        status: 'accepted',
        sessionId: SESSION_ID
      })
      expect(machine.observeSessionStart(issue.launchToken, sessionStart(), currentPty())).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'session-replay'
      })
      expect(
        machine.observeSessionStart(
          issue.launchToken,
          sessionStart({ sessionId: OTHER_SESSION_ID }),
          currentPty()
        )
      ).toEqual({ kind: 'consistency-only', status: 'rejected', reason: 'session-already-bound' })
    })

    it('freezes the launch-time account selection and verified profile snapshot', () => {
      const sourceSelection = { kind: 'managed' as const, accountId: 'claude-managed-a' }
      const launch = candidate({ accountSelection: sourceSelection })
      const { issue } = issued(new ClaudeHostLaunchCorrelationConsistency(), launch)

      sourceSelection.accountId = 'claude-managed-b'
      expect(issue.snapshot.accountId).toBe('claude-managed-a')
      expect(issue.snapshot.accountIdentity.accountId).toBe('claude-managed-a')
      expect(issue.snapshot.ownershipMarker).toEqual(managedAccountA?.ownershipMarker)
      expect(Object.isFrozen(issue.snapshot.accountIdentity)).toBe(true)
      expect(Object.isFrozen(issue.snapshot.ownershipMarker)).toBe(true)
    })

    it('captures the verified marker device and inode without persisting them', () => {
      const markerStat = lstatSync(claudeProfileMarkerPath(managedProfileA!), { bigint: true })
      expect(managedAccountA?.ownershipMarker).toEqual({
        device: markerStat.dev.toString(),
        inode: markerStat.ino.toString()
      })
      const result = new ClaudeHostLaunchCorrelationConsistency().issue(candidate())
      expect(result).toMatchObject({
        kind: 'consistency-only',
        status: 'issued',
        snapshot: {
          accountId: 'claude-managed-a',
          ownershipMarker: managedAccountA?.ownershipMarker
        }
      })
    })

    it('rejects a cloned marked profile even when its private symbol was copied', () => {
      const clonedVerification = { ...managedAccountA! }
      expect(isVerifiedClaudeManagedAccountProfile(managedAccountA)).toBe(true)
      expect(isVerifiedClaudeManagedAccountProfile(clonedVerification)).toBe(false)
      expect(
        new ClaudeHostLaunchCorrelationConsistency().issue(
          candidate({ accountVerification: clonedVerification })
        )
      ).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'account-identity-mismatch'
      })
    })

    it('requires the exact expected provider UUID for resume', () => {
      const resume = candidate({
        session: { kind: 'resume', expectedProviderSessionId: SESSION_ID }
      })
      const { machine, issue } = issued(new ClaudeHostLaunchCorrelationConsistency(), resume)

      expect(
        machine.observeSessionStart(
          issue.launchToken,
          sessionStart({ sessionId: OTHER_SESSION_ID, sessionStartSource: 'resume' }),
          currentPty()
        )
      ).toEqual({ kind: 'consistency-only', status: 'rejected', reason: 'resume-session-mismatch' })
      expect(
        machine.observeSessionStart(
          issue.launchToken,
          sessionStart({ sessionId: SESSION_ID, sessionStartSource: 'resume' }),
          currentPty()
        )
      ).toEqual({ kind: 'consistency-only', status: 'accepted', sessionId: SESSION_ID })
    })

    it('refuses startup source on a resume even when the UUID matches', () => {
      const { machine, issue } = issued(
        new ClaudeHostLaunchCorrelationConsistency(),
        candidate({ session: { kind: 'resume', expectedProviderSessionId: SESSION_ID } })
      )
      expect(machine.observeSessionStart(issue.launchToken, sessionStart(), currentPty())).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'unexpected-session-start-source'
      })
    })

    it.each([
      [
        'system account selection',
        { accountSelection: { kind: 'system' as const } },
        'account-not-managed'
      ],
      [
        'unknown account selection',
        { accountSelection: { kind: 'unknown' as const } },
        'account-not-managed'
      ],
      [
        'account identity for a different managed account',
        { accountSelection: { kind: 'managed' as const, accountId: 'claude-managed-b' } },
        'account-identity-mismatch'
      ],
      ['WSL host', { isWsl: true }, 'non-local-runtime'],
      ['remote connection', { connectionId: 'runtime:remote' }, 'non-local-runtime'],
      ['missing PTY incarnation', { pty: { incarnationId: null } }, 'missing-pty-incarnation'],
      [
        'oversized PTY incarnation',
        { pty: { incarnationId: 'x'.repeat(129) } },
        'missing-pty-incarnation'
      ],
      ['stopped PTY', { pty: { running: false } }, 'pty-not-running'],
      ['tab ID in place of PTY ID', { pty: { id: TAB_ID } }, 'invalid-pane-identity'],
      [
        'invalid resume UUID',
        { session: { kind: 'resume' as const, expectedProviderSessionId: 'status-row-id' } },
        'invalid-resume-session'
      ]
    ] as const)('rejects %s before issuing a token', (_label, override, reason) => {
      const result = new ClaudeHostLaunchCorrelationConsistency().issue(candidate(override))

      expect(result).toEqual({ kind: 'consistency-only', status: 'rejected', reason })
      expect(result).not.toHaveProperty('launchToken')
    })

    it.each([
      ['missing token', 'missing', {}, {}, 'missing-launch-token'],
      ['stale token', 'stale', {}, {}, 'stale-or-wrong-launch-token'],
      ['non-Claude event', 'valid', { provider: 'codex' }, {}, 'wrong-provider-event'],
      ['non-SessionStart event', 'valid', { eventName: 'Stop' }, {}, 'wrong-provider-event'],
      [
        'clear event',
        'valid',
        { sessionStartSource: 'clear' },
        {},
        'unexpected-session-start-source'
      ],
      [
        'compact event',
        'valid',
        { sessionStartSource: 'compact' },
        {},
        'unexpected-session-start-source'
      ],
      [
        'fork source',
        'valid',
        { sessionStartSource: 'fork' },
        {},
        'unexpected-session-start-source'
      ],
      [
        'resume source on fresh launch',
        'valid',
        { sessionStartSource: 'resume' },
        {},
        'unexpected-session-start-source'
      ],
      [
        'unknown start source',
        'valid',
        { sessionStartSource: undefined },
        {},
        'unexpected-session-start-source'
      ],
      [
        'unknown root status',
        'valid',
        { rootAdmission: 'unknown' },
        {},
        'root-session-not-established'
      ],
      ['child admission', 'valid', { rootAdmission: 'child' }, {}, 'root-session-not-established'],
      ['Claude child agent', 'valid', { agentId: 'agent-child' }, {}, 'child-session'],
      ['fork metadata', 'valid', { parentSessionId: SESSION_ID }, {}, 'forked-session'],
      ['fork flag', 'valid', { isFork: true }, {}, 'forked-session'],
      ['missing fork verdict', 'valid', { isFork: undefined }, {}, 'forked-session'],
      ['remote event', 'valid', { isRemote: true }, {}, 'remote-session'],
      ['WSL event', 'valid', { isWsl: true }, {}, 'remote-session'],
      ['missing WSL verdict', 'valid', { isWsl: undefined }, {}, 'remote-session'],
      ['missing remote verdict', 'valid', { isRemote: undefined }, {}, 'remote-session'],
      [
        'different pane',
        'valid',
        { paneKey: makePaneKey('other-tab', LEAF_ID) },
        {},
        'binding-unknown'
      ],
      [
        'different worktree',
        'valid',
        { worktreeId: 'other-worktree' },
        {},
        'wrong-pane-or-worktree'
      ],
      ['remote host identity', 'valid', { connectionId: 'runtime:other' }, {}, 'remote-session'],
      ['wrong PTY id', 'valid', {}, { ptyId: 'pty-other' }, 'pty-incarnation-mismatch'],
      [
        'reused PTY id with another incarnation',
        'valid',
        {},
        { incarnationId: 'incarnation-old' },
        'pty-incarnation-mismatch'
      ],
      [
        'PTY moved to another pane',
        'valid',
        {},
        { paneKey: makePaneKey('other-tab', LEAF_ID) },
        'pty-incarnation-mismatch'
      ],
      ['stopped PTY', 'valid', {}, { running: false }, 'pty-not-running'],
      ['replayed SessionStart', 'valid', { isReplay: true }, {}, 'session-replay'],
      ['missing replay verdict', 'valid', { isReplay: undefined }, {}, 'session-replay'],
      [
        'non-UUID session id',
        'valid',
        { sessionId: 'renderer-session-row' },
        {},
        'invalid-session-id'
      ]
    ] as const)(
      'rejects %s without accepting a provider UUID',
      (_label, tokenMode, eventPatch, ptyPatch, reason) => {
        const { machine, issue } = issued()
        const token =
          tokenMode === 'valid'
            ? issue.launchToken
            : tokenMode === 'missing'
              ? undefined
              : 'stale-token'
        expect(
          machine.observeSessionStart(token, sessionStart(eventPatch), currentPty(ptyPatch))
        ).toEqual({ kind: 'consistency-only', status: 'rejected', reason })
      }
    )

    it('rejects cross-pane token use and a second active incarnation', () => {
      const machine = new ClaudeHostLaunchCorrelationConsistency()
      const first = issued(machine)
      const otherPane = makePaneKey('other-tab', LEAF_ID)
      const second = machine.issue(
        candidate({
          paneKey: otherPane,
          tabId: 'other-tab',
          pty: { id: 'pty-local-2', incarnationId: 'incarnation-2', running: true }
        })
      )
      expect(second).toMatchObject({ status: 'issued' })
      const secondIssue = second as Extract<ClaudeHostLaunchCorrelationIssue, { status: 'issued' }>
      expect(secondIssue.launchToken).not.toBe(first.issue.launchToken)
      expect(
        machine.observeSessionStart(
          first.issue.launchToken,
          sessionStart({ paneKey: otherPane }),
          currentPty({
            ptyId: 'pty-local-2',
            incarnationId: 'incarnation-2',
            paneKey: otherPane
          })
        )
      ).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'stale-or-wrong-launch-token'
      })

      const next = new ClaudeHostLaunchCorrelationConsistency()
      expect(next.issue(candidate())).toMatchObject({ status: 'issued' })
      expect(
        next.issue(
          candidate({
            pty: { id: 'pty-local-2', incarnationId: 'incarnation-2', running: true }
          })
        )
      ).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'pane-already-bound'
      })
    })

    it('retires and closes only the matching PTY incarnation, fencing late events', () => {
      const retired = issued()
      expect(retired.machine.retire(PANE_KEY, PTY_ID, 'incarnation-old')).toBe(false)
      expect(retired.machine.retire(PANE_KEY, PTY_ID, INCARNATION_ID)).toBe(true)
      expect(
        retired.machine.observeSessionStart(retired.issue.launchToken, sessionStart(), currentPty())
      ).toEqual({ kind: 'consistency-only', status: 'rejected', reason: 'binding-retired' })

      const closed = issued(new ClaudeHostLaunchCorrelationConsistency())
      expect(closed.machine.close(PANE_KEY, PTY_ID, INCARNATION_ID)).toBe(true)
      expect(
        closed.machine.observeSessionStart(closed.issue.launchToken, sessionStart(), currentPty())
      ).toEqual({ kind: 'consistency-only', status: 'rejected', reason: 'binding-closed' })
    })

    it('does not reopen a retired pane from a stale token or change its account snapshot', () => {
      const machine = new ClaudeHostLaunchCorrelationConsistency()
      const old = issued(machine)
      expect(machine.retire(PANE_KEY, PTY_ID, INCARNATION_ID)).toBe(true)

      const replacement = machine.issue(
        candidate({
          accountSelection: { kind: 'managed', accountId: 'claude-managed-b' },
          accountVerification: managedAccountB!,
          pty: { id: 'pty-local-2', incarnationId: 'incarnation-2', running: true }
        })
      )
      expect(replacement).toMatchObject({ kind: 'consistency-only', status: 'issued' })
      expect(
        machine.observeSessionStart(old.issue.launchToken, sessionStart(), currentPty())
      ).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'stale-or-wrong-launch-token'
      })
      expect(old.issue.snapshot.accountId).toBe('claude-managed-a')
    })

    it('bounds live bindings and reclaims retired tombstones without reviving old tokens', () => {
      const machine = new ClaudeHostLaunchCorrelationConsistency()
      const first = issued(machine)
      for (let i = 1; i < 512; i++) {
        const tab = `tab-${i}`
        expect(
          machine.issue(
            candidate({
              tabId: tab,
              paneKey: makePaneKey(tab, LEAF_ID),
              pty: { id: `pty-${i}`, incarnationId: `inc-${i}`, running: true }
            })
          )
        ).toMatchObject({ status: 'issued' })
      }
      const lastCandidate = candidate({
        tabId: 'new-tab',
        paneKey: makePaneKey('new-tab', LEAF_ID),
        pty: { id: 'pty-new', incarnationId: 'inc-new', running: true }
      })
      expect(machine.issue(lastCandidate)).toEqual({
        kind: 'consistency-only',
        status: 'rejected',
        reason: 'binding-capacity-exceeded'
      })
      expect(machine.retire(PANE_KEY, PTY_ID, INCARNATION_ID)).toBe(true)
      expect(machine.issue(lastCandidate)).toMatchObject({ status: 'issued' })
      expect(
        machine.observeSessionStart(first.issue.launchToken, sessionStart(), currentPty())
      ).toEqual({ kind: 'consistency-only', status: 'rejected', reason: 'binding-unknown' })
    })

    it('leaves the provider-global hook write policy disabled', () => {
      expect(canAshWriteProviderGlobalHooks()).toBe(false)
    })
  }
)
