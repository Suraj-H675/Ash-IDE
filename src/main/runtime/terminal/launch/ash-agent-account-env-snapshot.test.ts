import { describe, expect, it, vi } from 'vitest'
import type { TerminalWorkspaceLaunchScope } from '../../orchestration/terminal-authority/structured-sessions/runtime-legacy-worker-terminal-recovery-types'
import {
  prepareHostAgentTerminalLaunch,
  withHostAccountLaunchEnv
} from './runtime-agent-terminal-startup'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only connectionId is read by the tested host-launch preparation helper.
const LOCAL_WORKSPACE = { connectionId: null } as TerminalWorkspaceLaunchScope

describe('Ash process-bound provider account environments', () => {
  it('retains a caller-pinned Claude home when the host has no selected account', async () => {
    const request = {
      launchAgent: 'claude' as const,
      accountEnv: { CLAUDE_CONFIG_DIR: '/fixture/claude-a' }
    }
    const launch = { launchAgent: 'claude' as const, env: { PATH: '/usr/bin' } }
    const services = {
      prepareHostAgentLaunch: vi.fn(async () => {}),
      hostLaunchEnvFor: vi.fn(() => ({}))
    }

    const prepared = await prepareHostAgentTerminalLaunch(LOCAL_WORKSPACE, request, launch, services)

    expect(prepared.env).toEqual({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/fixture/claude-a' })
    expect(services.prepareHostAgentLaunch).toHaveBeenCalledTimes(1)
    expect(services.prepareHostAgentLaunch).toHaveBeenCalledWith('claude')
    expect(services.hostLaunchEnvFor).toHaveBeenCalledWith('claude')
    expect(launch.env).toEqual({ PATH: '/usr/bin' })
  })

  it('snapshots Codex home per launch instead of changing a running launch after selection', async () => {
    let selected = '/fixture/codex-a'
    const services = {
      prepareHostAgentLaunch: vi.fn(async () => {}),
      hostLaunchEnvFor: vi.fn(() => ({ CODEX_HOME: selected }))
    }
    const request = { launchAgent: 'codex' as const }
    const launch = { launchAgent: 'codex' as const, env: { TERM: 'xterm-256color' } }
    const first = await prepareHostAgentTerminalLaunch(LOCAL_WORKSPACE, request, launch, services)
    selected = '/fixture/codex-b'
    const second = await prepareHostAgentTerminalLaunch(LOCAL_WORKSPACE, request, launch, services)

    expect(first.env).toEqual({ TERM: 'xterm-256color', CODEX_HOME: '/fixture/codex-a' })
    expect(second.env).toEqual({ TERM: 'xterm-256color', CODEX_HOME: '/fixture/codex-b' })
    expect(first.env).not.toBe(second.env)
    expect(launch.env).toEqual({ TERM: 'xterm-256color' })
  })

  it('honors explicit accountEnv over desktop selection and raw caller env', () => {
    const request = {
      env: { CLAUDE_CONFIG_DIR: '/fixture/raw-caller' },
      accountEnv: { CLAUDE_CONFIG_DIR: '/fixture/pinned' }
    }
    const launch = { env: { CLAUDE_CONFIG_DIR: '/fixture/plan', PATH: '/usr/bin' } }
    const prepared = withHostAccountLaunchEnv(request, launch, {
      CLAUDE_CONFIG_DIR: '/fixture/desktop-selected'
    })

    expect(prepared.env).toEqual({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/fixture/pinned' })
    request.accountEnv.CLAUDE_CONFIG_DIR = '/fixture/next-selection'
    expect(prepared.env?.CLAUDE_CONFIG_DIR).toBe('/fixture/pinned')
    expect(launch.env.CLAUDE_CONFIG_DIR).toBe('/fixture/plan')
  })

  it('leaves unpinned, ordinary terminal creation unchanged', () => {
    const launch = { env: { PATH: '/usr/bin' } }
    expect(withHostAccountLaunchEnv({}, launch, {})).toBe(launch)
  })

  it('never applies host-local account roots to a remotely routed workspace', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only connectionId is read by the tested host-launch preparation helper.
    const remoteWorkspace = { connectionId: 'remote-host' } as TerminalWorkspaceLaunchScope
    const launch = { launchAgent: 'claude' as const, env: { PATH: '/usr/bin' } }
    const services = {
      prepareHostAgentLaunch: vi.fn(async () => {}),
      hostLaunchEnvFor: vi.fn(() => ({ CLAUDE_CONFIG_DIR: '/fixture/local' }))
    }
    const result = await prepareHostAgentTerminalLaunch(
      remoteWorkspace,
      { accountEnv: { CLAUDE_CONFIG_DIR: '/fixture/local' } },
      launch,
      services
    )
    expect(result).toBe(launch)
    expect(services.prepareHostAgentLaunch).not.toHaveBeenCalled()
    expect(services.hostLaunchEnvFor).not.toHaveBeenCalled()
  })
})
