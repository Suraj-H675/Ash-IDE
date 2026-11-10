import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { canAshWriteProviderGlobalHooks } from '../../../agent-hooks/ash-hook-ownership-policy'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { AGENT_SESSION_CLAIM_DIGEST_VERSION } from '../../../../shared/agent-session/agent-session-host-authority'
import { LocalPtyProvider } from '../../../providers/local-pty/local-pty-provider'
import { getLocalPtyProvider, setLocalPtyProvider } from '../provider/registry'
import { isClaudeLaunchCommand } from '../host-env/fresh-spawn-routing'
import type { Store } from '../../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { makeRuntimePtySpawnTestDeps } from './spawn-preflight-test-deps-fixture'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import { spawnPtyFromRuntimeController } from './spawn'
import {
  readCommittedLocalPtySpawnEvidence,
  recordCommittedLocalPtySpawnEvidence,
  retireCommittedLocalPtySpawnEvidence,
  validateCommittedLocalPtySpawnEvidence,
  isFreshLocalClaudeShellEntryCandidate,
  type CommittedLocalPtySpawnEvidenceRuntime
} from './committed-local-pty-spawn-evidence'
import {
  createRuntimePtySpawnState,
  type RuntimePtySpawnArgs,
  type RuntimePtySpawnState
} from './spawn-state'
import type { PtySpawnOutcome } from '../spawn-outcome'

vi.mock('../../../../shared/jcode-runtime-dir', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../shared/jcode-runtime-dir')>()
  return { ...original, ensureJcodeRuntimeDir: vi.fn().mockResolvedValue(undefined) }
})

const PTY_ID = 'host-local-pty-actual'
const INCARNATION_ID = 'provider-incarnation-actual'
const WORKTREE_ID = 'repo::/worktree'
const TAB_ID = 'host-tab'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)
const LAUNCH_TOKEN = 'host-launch-token-for-private-hash'

type PaneSession = {
  tabsByWorktree: Record<string, { id: string; worktreeId: string }[]>
  terminalLayoutsByTabId: Record<string, { ptyIdsByLeafId: Record<string, string | undefined> }>
  terminalPtyIncarnationsByPaneKey: Record<string, string | undefined>
}

function makeState(
  changes: Partial<{
    args: Partial<RuntimePtySpawnArgs>
    result: Partial<RuntimePtySpawnState['result']>
    paneSession: PaneSession
    provider: RuntimePtySpawnState['provider']
    isDaemonHostSpawn: boolean
    expectedWslDistro: string | null
    runtimeTarget: 'host' | 'wsl'
    isClaudeLaunch: boolean
    hostSessionBinding: boolean
    effectiveLaunchToken: string | undefined
    stablePaneOwner: RuntimePtySpawnState['stablePaneOwner']
  }> = {}
): RuntimePtySpawnState {
  const paneSession =
    changes.paneSession ??
    ({
      tabsByWorktree: {
        [WORKTREE_ID]: [{ id: TAB_ID, worktreeId: WORKTREE_ID }]
      },
      terminalLayoutsByTabId: {
        [TAB_ID]: { ptyIdsByLeafId: { [LEAF_ID]: PTY_ID } }
      },
      terminalPtyIncarnationsByPaneKey: { [PANE_KEY]: INCARNATION_ID }
    } satisfies PaneSession)
  const store = {
    getWorkspaceSession: () => paneSession
  } as unknown as Store
  const deps = {
    ...makeRuntimePtySpawnTestDeps(),
    store,
    runtime: undefined
  }
  const args: RuntimePtySpawnArgs = {
    cols: 120,
    rows: 40,
    command: 'claude',
    launchAgent: 'claude',
    worktreeId: WORKTREE_ID,
    tabId: TAB_ID,
    leafId: LEAF_ID,
    persistHostSessionBinding: true,
    launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
    launchToken: LAUNCH_TOKEN,
    env: { ORCA_AGENT_LAUNCH_TOKEN: LAUNCH_TOKEN },
    ...changes.args
  }
  const state = createRuntimePtySpawnState(deps, args)
  state.provider = changes.provider ?? new LocalPtyProvider()
  state.isClaudeLaunch = changes.isClaudeLaunch ?? isClaudeLaunchCommand(args.command)
  state.launchCommand = args.command
  state.spawnOptions = {
    cols: 120,
    rows: 40,
    command: args.command,
    launchAgent: args.launchAgent,
    env: {
      ORCA_AGENT_LAUNCH_TOKEN: changes.effectiveLaunchToken ?? LAUNCH_TOKEN
    }
  }
  state.hostSessionBinding =
    changes.hostSessionBinding === false
      ? undefined
      : { store, worktreeId: WORKTREE_ID, tabId: TAB_ID, leafId: LEAF_ID }
  state.shouldPersistHostSessionBinding = changes.hostSessionBinding !== false
  state.isDaemonHostSpawn = changes.isDaemonHostSpawn ?? false
  state.expectedWslDistro = changes.expectedWslDistro ?? null
  state.codexSelectionTarget = { runtime: changes.runtimeTarget ?? 'host' }
  state.result = {
    id: PTY_ID,
    incarnationId: INCARNATION_ID,
    ...changes.result
  }
  state.stablePaneOwner = changes.stablePaneOwner ?? null
  return state
}

function committedOutcome(state: RuntimePtySpawnState): PtySpawnOutcome {
  return {
    kind: 'committed',
    result: {
      id: state.result.id,
      incarnationId: state.result.incarnationId
    }
  }
}

function makeEvidenceRuntime(): {
  runtime: CommittedLocalPtySpawnEvidenceRuntime
  exitListeners: Map<string, () => void>
  unsubscribe: ReturnType<typeof vi.fn>
} {
  const exitListeners = new Map<string, () => void>()
  const unsubscribe = vi.fn()
  const runtime = {
    subscribeToPtyExit: vi.fn((ptyId: string, listener: () => void) => {
      exitListeners.set(ptyId, listener)
      return unsubscribe
    })
  }
  return {
    runtime: runtime as unknown as CommittedLocalPtySpawnEvidenceRuntime,
    exitListeners,
    unsubscribe
  }
}

describe('committed local PTY spawn evidence', () => {
  const committedSpawnCases = [
    {
      name: 'direct planned Claude launch',
      command: 'claude',
      agentCommand: 'claude',
      accepted: true
    },
    {
      name: 'echo claude in a shell',
      command: 'echo claude',
      agentCommand: 'claude',
      accepted: false
    },
    {
      name: 'shell wrapper invoking Claude',
      command: 'sh -c "claude"',
      agentCommand: 'claude',
      accepted: false
    },
    {
      name: 'compound command after Claude',
      command: 'claude; echo unsafe',
      agentCommand: 'claude',
      accepted: false
    },
    {
      name: 'conflicting saved launch config',
      command: 'claude',
      agentCommand: 'codex',
      accepted: false
    }
  ] as const

  it.each(committedSpawnCases)(
    'records real commit facts only for $name',
    async ({ command, agentCommand, accepted }) => {
      // A planned Claude launch also performs normal trust setup. Keep all of
      // that behavior inside disposable files, never the user's real home.
      const disposableHome = mkdtempSync(join(tmpdir(), 'ash-pty-commit-evidence-'))
      const disposableClaudeDir = join(disposableHome, '.claude')
      mkdirSync(disposableClaudeDir)
      writeFileSync(join(disposableClaudeDir, '.claude.json'), '{}\n', { mode: 0o600 })
      vi.stubEnv('HOME', disposableHome)
      vi.stubEnv('USERPROFILE', disposableHome)
      vi.stubEnv('CLAUDE_CONFIG_DIR', disposableClaudeDir)
      const originalProvider = getLocalPtyProvider()
      const provider = new LocalPtyProvider()
      const spawn = vi
        .spyOn(provider, 'spawn')
        .mockResolvedValue({ id: PTY_ID, incarnationId: INCARNATION_ID })

      const paneSession = {
        tabsByWorktree: {
          [WORKTREE_ID]: [{ id: TAB_ID, worktreeId: WORKTREE_ID }]
        },
        terminalLayoutsByTabId: {
          [TAB_ID]: {
            root: { type: 'leaf', leafId: LEAF_ID },
            ptyIdsByLeafId: {}
          }
        },
        terminalPtyIncarnationsByPaneKey: {}
      } as unknown as PaneSession
      let evidenceVisibleBeforePaneCommit = false
      const store = {
        getWorkspaceSession: () => paneSession,
        persistPtyBinding: vi.fn(async () => {
          evidenceVisibleBeforePaneCommit =
            readCommittedLocalPtySpawnEvidence(runtime, PTY_ID, INCARNATION_ID) !== null
          paneSession.terminalLayoutsByTabId[TAB_ID]!.ptyIdsByLeafId[LEAF_ID] = PTY_ID
          paneSession.terminalPtyIncarnationsByPaneKey[PANE_KEY] = INCARNATION_ID
          return true
        })
      } as unknown as Store
      const exitListeners = new Map<string, () => void>()
      const runtime = {
        registerPty: vi.fn(),
        subscribeToPtyExit: vi.fn((ptyId: string, listener: () => void) => {
          exitListeners.set(ptyId, listener)
          return () => {
            exitListeners.delete(ptyId)
          }
        })
      }
      const deps = {
        ...makeRuntimePtySpawnTestDeps(),
        adoptStablePane: async (
          adoptArgs: Parameters<PtyRuntimeControllerDeps['adoptStablePane']>[0]
        ) => {
          if (!adoptArgs.spawnFresh) {
            throw new Error('fixture requires a fresh-spawn callback')
          }
          await adoptArgs.spawnFresh({ mustExist: false })
          return null
        },
        store,
        // The fixture exercises only registerPty and subscribeToPtyExit.
        runtime: runtime as unknown as OrcaRuntimeService
      }

      try {
        setLocalPtyProvider(provider)
        const response = await spawnPtyFromRuntimeController(deps, {
          cols: 120,
          rows: 40,
          cwd: process.cwd(),
          command,
          launchAgent: 'claude',
          worktreeId: WORKTREE_ID,
          tabId: TAB_ID,
          leafId: LEAF_ID,
          persistHostSessionBinding: true,
          launchConfig: { agentCommand, agentArgs: '', agentEnv: {} },
          launchToken: LAUNCH_TOKEN,
          env: {
            ORCA_AGENT_LAUNCH_TOKEN: LAUNCH_TOKEN,
            HOME: disposableHome,
            CLAUDE_CONFIG_DIR: disposableClaudeDir
          }
        })

        expect(spawn).toHaveBeenCalledOnce()
        expect(store.persistPtyBinding).toHaveBeenCalledOnce()
        expect(evidenceVisibleBeforePaneCommit).toBe(false)
        expect(response).toMatchObject({ id: PTY_ID, incarnationId: INCARNATION_ID })
        const recorded = readCommittedLocalPtySpawnEvidence(runtime, PTY_ID, INCARNATION_ID)
        if (accepted) {
          expect(recorded).toMatchObject({
            ptyId: response.id,
            incarnationId: response.incarnationId,
            paneKey: PANE_KEY,
            worktreeId: WORKTREE_ID,
            launchTokenHash: createHash('sha256').update(LAUNCH_TOKEN).digest('hex')
          })
        } else {
          // The actual runtime preflight sees these command strings. A lexical
          // match or saved agent label must not promote shell instructions.
          expect(recorded).toBeNull()
        }
      } finally {
        setLocalPtyProvider(originalProvider)
        retireCommittedLocalPtySpawnEvidence(runtime, PTY_ID, INCARNATION_ID)
        vi.unstubAllEnvs()
        rmSync(disposableHome, { recursive: true, force: true })
      }
    }
  )

  it('records only the committed local provider identity, persisted pane binding, and token hash', () => {
    const state = makeState()
    const outcome = committedOutcome(state)
    const runtime = makeEvidenceRuntime()
    let selectedAccount = 'managed-account-before-spawn'

    expect(canAshWriteProviderGlobalHooks()).toBe(false)
    expect(validateCommittedLocalPtySpawnEvidence(state, outcome)).toMatchObject({
      accepted: true,
      evidence: {
        provider: 'local-pty',
        spawnState: 'fresh-committed',
        ptyId: PTY_ID,
        incarnationId: INCARNATION_ID,
        worktreeId: WORKTREE_ID,
        tabId: TAB_ID,
        leafId: LEAF_ID,
        paneKey: PANE_KEY,
        launchTokenHash: createHash('sha256').update(LAUNCH_TOKEN).digest('hex'),
        accountEvidence: { status: 'missing' }
      }
    })

    expect(recordCommittedLocalPtySpawnEvidence(runtime.runtime, state, outcome)).toBe(true)
    const recorded = readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)
    expect(recorded).not.toBeNull()
    expect(recorded && Object.isFrozen(recorded)).toBe(true)
    expect(recorded && Object.isFrozen(recorded.accountEvidence)).toBe(true)
    expect(JSON.stringify(recorded)).not.toContain(LAUNCH_TOKEN)
    expect(JSON.stringify(recorded)).not.toContain(selectedAccount)

    selectedAccount = 'managed-account-after-spawn'
    expect(readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)).toBe(
      recorded
    )
    expect(JSON.stringify(recorded)).not.toContain(selectedAccount)
    expect(recordCommittedLocalPtySpawnEvidence(runtime.runtime, state, outcome)).toBe(false)
    expect(runtime.exitListeners.has(PTY_ID)).toBe(true)
  })

  it('limits native shell observation attachment to a fresh local host Claude candidate', () => {
    expect(isFreshLocalClaudeShellEntryCandidate(makeState())).toBe(true)
    expect(
      isFreshLocalClaudeShellEntryCandidate(makeState({ args: { sessionId: 'reattach-id' } }))
    ).toBe(false)
    expect(
      isFreshLocalClaudeShellEntryCandidate(makeState({ args: { connectionId: 'remote' } }))
    ).toBe(false)
    expect(isFreshLocalClaudeShellEntryCandidate(makeState({ runtimeTarget: 'wsl' }))).toBe(false)
    expect(isFreshLocalClaudeShellEntryCandidate(makeState({ isDaemonHostSpawn: true }))).toBe(
      false
    )
    expect(isFreshLocalClaudeShellEntryCandidate(makeState({ isClaudeLaunch: false }))).toBe(false)
  })

  const rejectedCandidates: Array<
    [string, Parameters<typeof makeState>[0] & { outcome?: PtySpawnOutcome }, string]
  > = [
    [
      'adopted result',
      { outcome: { kind: 'adopted', result: { id: PTY_ID } } },
      'spawn-not-committed'
    ],
    [
      'stable pane owner',
      {
        stablePaneOwner: {
          handle: 'existing-owner',
          tabId: TAB_ID,
          leafId: LEAF_ID,
          ptyId: PTY_ID
        }
      },
      'stable-pane-adopted'
    ],
    ['provider reattach', { result: { isReattach: true } }, 'provider-reattached'],
    [
      'adopted agent session',
      {
        result: {
          agentSessionEnsure: {
            disposition: 'adopted',
            owner: {
              claim: {
                digestVersion: AGENT_SESSION_CLAIM_DIGEST_VERSION,
                keyId: 'fixture-key',
                identityDigest: 'fixture-identity',
                worktreeScopeDigest: 'fixture-worktree',
                agent: 'claude'
              },
              generation: 'fixture-generation',
              phase: 'live',
              ptyId: PTY_ID,
              surface: {
                worktreeId: WORKTREE_ID,
                tabId: TAB_ID,
                leafId: LEAF_ID,
                terminalHandle: 'fixture-handle'
              }
            }
          }
        }
      },
      'stable-pane-adopted'
    ],
    ['remote connection', { args: { connectionId: 'ssh-connection' } }, 'remote-runtime'],
    ['daemon routed process', { isDaemonHostSpawn: true }, 'daemon-runtime'],
    ['WSL runtime', { runtimeTarget: 'wsl' }, 'wsl-runtime'],
    ['WSL distro', { expectedWslDistro: 'Ubuntu' }, 'wsl-runtime'],
    ['missing incarnation', { result: { incarnationId: undefined } }, 'missing-pty-identity'],
    ['missing launch token', { args: { launchToken: undefined } }, 'missing-launch-token'],
    ['effective launch token mismatch', { effectiveLaunchToken: 'other' }, 'launch-token-mismatch'],
    ['missing persisted pane binding', { hostSessionBinding: false }, 'missing-host-pane-binding'],
    ['synthetic early exit', { result: { exitedBeforeSpawnReply: true } }, 'missing-pty-identity'],
    [
      'stale persisted pane binding',
      {
        paneSession: {
          tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID, worktreeId: WORKTREE_ID }] },
          terminalLayoutsByTabId: {
            [TAB_ID]: { ptyIdsByLeafId: { [LEAF_ID]: 'replacement-pty' } }
          },
          terminalPtyIncarnationsByPaneKey: { [PANE_KEY]: 'replacement-incarnation' }
        }
      },
      'host-pane-binding-mismatch'
    ],
    ['echo Claude', { args: { command: 'echo claude' } }, 'not-claude-launch'],
    ['shell wrapper', { args: { command: 'sh -c "claude"' } }, 'not-claude-launch'],
    ['compound command', { args: { command: 'claude; echo unsafe' } }, 'not-claude-launch'],
    ['mismatched launch agent', { args: { launchAgent: 'codex' } }, 'not-claude-launch'],
    [
      'mismatched launch configuration',
      { args: { launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} } } },
      'not-claude-launch'
    ],
    ['renderer startup delivery', { args: { commandDelivery: 'renderer' } }, 'not-claude-launch'],
    ['custom shell override', { args: { shellOverride: '/bin/bash' } }, 'not-claude-launch']
  ]
  it.each(rejectedCandidates)(
    'rejects %s without issuing account evidence',
    (_name, changes, expectedReason) => {
      const state = makeState(changes)
      const outcome = changes.outcome ?? committedOutcome(state)
      const validation = validateCommittedLocalPtySpawnEvidence(state, outcome)
      expect(validation).toEqual({ accepted: false, reason: expectedReason })
    }
  )

  it('does not record another agent or an ordinary shell as a Claude launch', () => {
    const state = makeState({ isClaudeLaunch: false })
    const outcome = committedOutcome(state)
    const runtime = makeEvidenceRuntime()
    expect(validateCommittedLocalPtySpawnEvidence(state, outcome)).toEqual({
      accepted: false,
      reason: 'not-claude-launch'
    })
    expect(recordCommittedLocalPtySpawnEvidence(runtime.runtime, state, outcome)).toBe(false)
    expect(readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)).toBeNull()
  })

  it('does not retain evidence if the runtime reports the PTY already exited at subscription', () => {
    const state = makeState()
    const unsubscribe = vi.fn()
    const runtime: CommittedLocalPtySpawnEvidenceRuntime = {
      subscribeToPtyExit: vi.fn((_id, callback) => {
        callback()
        return unsubscribe
      })
    }
    expect(recordCommittedLocalPtySpawnEvidence(runtime, state, committedOutcome(state))).toBe(
      false
    )
    expect(readCommittedLocalPtySpawnEvidence(runtime, PTY_ID, INCARNATION_ID)).toBeNull()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('rolls back the receipt if the exit observer throws, including repeated registrations', () => {
    const subscribeToPtyExit = vi.fn((): (() => void) => {
      throw new Error('exit observer unavailable')
    })
    const runtime: CommittedLocalPtySpawnEvidenceRuntime = { subscribeToPtyExit }
    for (let i = 0; i < 260; i++) {
      const ptyId = `unobserved-pty-${i}`
      const incarnationId = `unobserved-incarnation-${i}`
      const state = makeState({
        result: { id: ptyId, incarnationId },
        paneSession: {
          tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID, worktreeId: WORKTREE_ID }] },
          terminalLayoutsByTabId: {
            [TAB_ID]: { ptyIdsByLeafId: { [LEAF_ID]: ptyId } }
          },
          terminalPtyIncarnationsByPaneKey: { [PANE_KEY]: incarnationId }
        }
      })
      expect(recordCommittedLocalPtySpawnEvidence(runtime, state, committedOutcome(state))).toBe(
        false
      )
      expect(readCommittedLocalPtySpawnEvidence(runtime, ptyId, incarnationId)).toBeNull()
    }
    expect(subscribeToPtyExit).toHaveBeenCalledTimes(260)
    const validState = makeState()
    expect(
      recordCommittedLocalPtySpawnEvidence(runtime, validState, committedOutcome(validState))
    ).toBe(false)
    expect(readCommittedLocalPtySpawnEvidence(runtime, PTY_ID, INCARNATION_ID)).toBeNull()
  })

  it('rejects a non-local provider, a refused commit, and provider-response identity changes', () => {
    const provider = {
      spawn: vi.fn()
    } as unknown as RuntimePtySpawnState['provider']
    const providerState = makeState({ provider })
    expect(
      validateCommittedLocalPtySpawnEvidence(providerState, committedOutcome(providerState))
    ).toMatchObject({
      accepted: false,
      reason: 'provider-mismatch'
    })

    const freshState = makeState()
    const runtime = makeEvidenceRuntime()
    expect(
      validateCommittedLocalPtySpawnEvidence(freshState, {
        kind: 'registration-exited',
        result: { id: PTY_ID, incarnationId: INCARNATION_ID }
      })
    ).toMatchObject({ accepted: false, reason: 'spawn-not-committed' })
    expect(
      recordCommittedLocalPtySpawnEvidence(runtime.runtime, freshState, {
        kind: 'registration-exited',
        result: { id: PTY_ID, incarnationId: INCARNATION_ID }
      })
    ).toBe(false)
    expect(readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)).toBeNull()
    expect(
      validateCommittedLocalPtySpawnEvidence(freshState, {
        kind: 'committed',
        result: { id: 'other-pty', incarnationId: INCARNATION_ID }
      })
    ).toMatchObject({ accepted: false, reason: 'provider-result-mismatch' })
    expect(
      validateCommittedLocalPtySpawnEvidence(freshState, {
        kind: 'committed',
        result: { id: PTY_ID, incarnationId: 'other-incarnation' }
      })
    ).toMatchObject({ accepted: false, reason: 'provider-result-mismatch' })
  })

  it('keeps evidence across pane close and retires only the matching incarnation on PTY exit', () => {
    const state = makeState()
    state.claudeShellEntryWitness = {
      kind: 'consistency-only',
      ptyId: PTY_ID,
      incarnationId: INCARNATION_ID,
      nativeSpawnAttempt: 'primary',
      configDirStatus: 'set',
      configDirPathSha256: createHash('sha256').update('/fixture/claude-home').digest('hex'),
      configDirSource: 'prepared',
      comparison: 'matched',
      selector: 'stable',
      selectedHostPointer: 'stable',
      routingPointer: 'selected-host',
      accountEvidence: {
        status: 'missing',
        reason: 'no-independent-private-marker-verified-profile-binding'
      }
    }
    const outcome = committedOutcome(state)
    const runtime = makeEvidenceRuntime()
    expect(recordCommittedLocalPtySpawnEvidence(runtime.runtime, state, outcome)).toBe(true)

    // Closing the GUI surface is not a PTY exit; the host-owned process can survive it.
    expect(
      readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)
    ).toMatchObject({ shellEntryEnvironment: { comparison: 'matched' } })
    retireCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, 'older-incarnation')
    expect(
      readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)
    ).not.toBeNull()

    runtime.exitListeners.get(PTY_ID)?.()
    expect(readCommittedLocalPtySpawnEvidence(runtime.runtime, PTY_ID, INCARNATION_ID)).toBeNull()
    expect(runtime.unsubscribe).toHaveBeenCalled()
  })

  it('bounds shell-entry observations with the committed PTY evidence store', () => {
    const exitListeners = new Map<string, () => void>()
    const runtime: CommittedLocalPtySpawnEvidenceRuntime = {
      subscribeToPtyExit: (ptyId, listener) => {
        exitListeners.set(ptyId, listener)
        return () => exitListeners.delete(ptyId)
      }
    }
    let lastId = ''
    let lastIncarnation = ''
    for (let index = 0; index < 257; index++) {
      const ptyId = `bounded-pty-${index}`
      const incarnationId = `bounded-incarnation-${index}`
      const state = makeState({
        result: { id: ptyId, incarnationId },
        paneSession: {
          tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID, worktreeId: WORKTREE_ID }] },
          terminalLayoutsByTabId: {
            [TAB_ID]: { ptyIdsByLeafId: { [LEAF_ID]: ptyId } }
          },
          terminalPtyIncarnationsByPaneKey: { [PANE_KEY]: incarnationId }
        }
      })
      state.claudeShellEntryWitness = {
        kind: 'consistency-only',
        ptyId,
        incarnationId,
        nativeSpawnAttempt: 'fallback',
        configDirStatus: 'set',
        configDirPathSha256: createHash('sha256').update('/fixture/fallback-home').digest('hex'),
        configDirSource: 'prepared',
        comparison: 'matched',
        selector: 'stable',
        selectedHostPointer: 'stable',
        routingPointer: 'selected-host',
        accountEvidence: {
          status: 'missing',
          reason: 'no-independent-private-marker-verified-profile-binding'
        }
      }
      expect(recordCommittedLocalPtySpawnEvidence(runtime, state, committedOutcome(state))).toBe(
        true
      )
      lastId = ptyId
      lastIncarnation = incarnationId
    }

    expect(
      readCommittedLocalPtySpawnEvidence(runtime, 'bounded-pty-0', 'bounded-incarnation-0')
    ).toBeNull()
    expect(exitListeners.size).toBe(256)
    expect(readCommittedLocalPtySpawnEvidence(runtime, lastId, lastIncarnation)).toMatchObject({
      shellEntryEnvironment: { nativeSpawnAttempt: 'fallback' }
    })
  })
})
