// @vitest-environment happy-dom

import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { AgentLaunchPaneNotice } from './AgentLaunchPaneNotice'
import { TerminalErrorToast } from './TerminalErrorToast'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('English startup failure surfaces', () => {
  it('renders English copy for both real startup failure mappings', async () => {
    await i18n.changeLanguage('en')
    const copy = {
      exit: 'Codex exited while starting. Run it in a terminal in this folder to see why, then try again.',
      workspace:
        "Codex couldn't start because its workspace is no longer available. Restore the workspace folder or open an available workspace, then try again.",
      unknown: "Couldn't confirm Codex started. Check its terminal before trying again."
    }
    for (const [code, expected, refusal] of [
      [
        'agent_session_exited_during_start',
        copy.exit,
        { kind: 'not-started', code: 'agent_session_exited_during_start' }
      ],
      ['worktree_not_found', copy.workspace, { kind: 'not-started', code: 'worktree_not_found' }],
      ['agent_session_operation_unknown', copy.unknown, { kind: 'unconfirmed' }]
    ] as const) {
      const toast = render(
        React.createElement(TerminalErrorToast, {
          error: `Error invoking remote method 'pty:spawn': Error: ${code}`,
          agentId: 'codex',
          paneOnClient: false,
          onDismiss: vi.fn()
        })
      )
      const pane = render(
        React.createElement(AgentLaunchPaneNotice, {
          refusal,
          agentId: 'codex',
          tabId: 'localized-startup-failure'
        })
      )
      expect(toast.container.querySelector('span')?.textContent).toBe(expected)
      expect(pane.container.querySelector('span')?.textContent).toBe(expected)
      expect(toast.container.querySelector('a')).toBeNull()
      expect(toast.container.textContent).not.toContain(code)
      expect(pane.container.textContent).not.toContain(code)
      toast.unmount()
      pane.unmount()
    }
  })
})

it.each(['not-started', 'unconfirmed'] as const)(
  'shows capacity once in a %s launch notice, retaining uncertainty',
  (kind) => {
    const pane = render(
      React.createElement(AgentLaunchPaneNotice, {
        refusal:
          kind === 'not-started'
            ? {
                kind,
                code: 'agent_session_exited_during_start',
                initialOutputDiagnostic: 'git-bash-console-capacity'
              }
            : { kind, initialOutputDiagnostic: 'git-bash-console-capacity' },
        agentId: 'codex',
        tabId: 'capacity'
      })
    )
    expect(pane.container.textContent).toContain('Close some Git Bash terminals')
    expect(pane.container.textContent?.match(/128/g)).toHaveLength(1)
    expect(pane.container.textContent?.includes("Couldn't confirm Codex started")).toBe(
      kind === 'unconfirmed'
    )
  }
)

it('falls back to English copy when the global i18n instance holds a legacy locale', async () => {
  await i18n.changeLanguage('zh')
  const pane = render(
    React.createElement(AgentLaunchPaneNotice, {
      refusal: { kind: 'unconfirmed', initialOutputDiagnostic: 'git-bash-console-capacity' },
      agentId: 'codex',
      tabId: 'capacity-fallback'
    })
  )
  expect(pane.container.textContent).toContain(
    "Couldn't confirm Codex started. Check its terminal before trying again."
  )
  expect(pane.container.textContent).toContain(
    'Git Bash reported its limit of 128 open terminals on this PC while starting Codex.'
  )
  expect(pane.container.textContent?.match(/128/g)).toHaveLength(1)
})
