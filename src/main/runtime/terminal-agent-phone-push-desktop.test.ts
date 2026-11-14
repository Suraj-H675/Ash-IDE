import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'
import { TerminalAgentPhonePush } from './terminal-agent-phone-push'

function makeHarness(
  input: {
    hasWindow?: boolean
    disabled?: boolean
    muted?: boolean
    completed?: boolean
  } = {}
) {
  const row = {
    paneKey: 'tab-1:leaf-1',
    state: input.completed === false ? 'blocked' : 'done',
    stateStartedAt: 123,
    receivedAt: 124,
    connectionId: null,
    agentType: 'codex',
    prompt: 'Test work'
  } as AgentStatusIpcPayload
  const dispatch = vi.fn()
  const notifyDesktop = vi.fn()
  const push = new TerminalAgentPhonePush({
    hasWindow: () => input.hasWindow ?? false,
    readNotificationSettings: () => ({
      ...getDefaultNotificationSettings(),
      enabled: !input.disabled
    }),
    readWorkspaceLabels: () => ({ worktreeLabel: 'Test-owned project' }),
    isWorkspaceMuted: () => input.muted ?? false,
    readOrchestration: () => undefined,
    readTerminalTitle: () => null,
    readHookRow: () => row,
    dispatch,
    notifyDesktop,
    setTimer: () => ({ cancel: () => {} }),
    now: () => 1_000_000
  })
  const event = {
    kind: 'moved' as const,
    paneKey: 'tab-1:leaf-1',
    workspace: { worktreeId: '/var/tmp/ash-notification-test', sshHostId: null },
    from: 'working' as const,
    to: input.completed === false ? ('needs-you' as const) : ('done' as const),
    at: 125,
    transition: input.completed === false ? ('needs-input' as const) : ('turn-finished' as const)
  }
  return { push, dispatch, notifyDesktop, event }
}

describe('windowless agent completion native notification fanout', () => {
  it('sends an OS banner and retains local notification stream for a new windowless completion', () => {
    const { push, dispatch, notifyDesktop, event } = makeHarness()
    push.observe(event)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ source: 'agent-task-complete' })
    expect(dispatch.mock.calls[0]?.[0]).not.toHaveProperty('desktopAllowed')
    expect(notifyDesktop).toHaveBeenCalledOnce()
    expect(notifyDesktop.mock.calls[0]?.[0]).toEqual({
      title: expect.any(String),
      body: expect.any(String)
    })
  })

  it('does not emit a second OS banner when the GUI owns the agent notification', () => {
    const { push, notifyDesktop, dispatch, event } = makeHarness({ hasWindow: true })
    push.observe(event)
    expect(notifyDesktop).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('respects disabled desktop notification preferences', () => {
    const { push, notifyDesktop, dispatch, event } = makeHarness({ disabled: true })
    push.observe(event)
    expect(notifyDesktop).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ desktopAllowed: false })
  })

  it('does not deliver native alerts from muted workspaces', () => {
    const { push, notifyDesktop, dispatch, event } = makeHarness({ muted: true })
    push.observe(event)
    expect(notifyDesktop).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('includes windowless blocked-agent attention when enabled', () => {
    const { push, notifyDesktop, event } = makeHarness({ completed: false })
    push.observe(event)
    expect(notifyDesktop).toHaveBeenCalledOnce()
  })
})
