import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canAshWriteProviderGlobalHooks } from '../../../agent-hooks/ash-hook-ownership-policy'
import { createAshClaudeSessionSettings } from '../../../agent-hooks/session/ash-claude-session-settings'
import {
  setupLayoutOwnerRuntime,
  WORKTREE_ID
} from '../../orca-runtime-tests/orca-runtime-layout-owner-start-fixture'

vi.mock('../../../../shared/layout-owner-switch', () => ({ ORCA_LAYOUT_OWNER_IS_MAIN: true }))

const fixtures: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function missingOrDamagedOverlay(mode: 'missing' | 'damaged') {
  const root = mkdtempSync(join(tmpdir(), 'ash-claude-disabled-hook-fallback-'))
  fixtures.push(root)
  const foreignConfig = join(root, 'foreign-claude')
  mkdirSync(foreignConfig, { mode: 0o700 })
  const foreignSettings = join(foreignConfig, 'settings.json')
  const sentinel = JSON.stringify(
    {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'foreign-provider-hook' }] }] }
    },
    null,
    2
  )
  writeFileSync(foreignSettings, sentinel, { mode: 0o600 })

  const sessionId = randomUUID()
  const overlay = await createAshClaudeSessionSettings({
    ashUserData: root,
    sessionId,
    hooks: [{ event: 'SessionStart', scriptPath: join(root, 'unused-ash-hook.sh') }]
  })
  const receiptPath = `${overlay.settingsPath}.receipt.json`
  if (mode === 'missing') {
    unlinkSync(receiptPath)
  } else {
    writeFileSync(receiptPath, '{"invalid":true}', { mode: 0o600 })
  }
  vi.stubEnv('ASH_USER_DATA_PATH', root)
  vi.stubEnv('CLAUDE_CONFIG_DIR', foreignConfig)
  return { root, sessionId, overlay, sentinel, foreignSettings }
}

describe('AG-07: ordinary host Claude launch when hook integration is unavailable', () => {
  it.each(['missing', 'damaged'] as const)(
    'launches exactly one Claude PTY even when an Ash-private overlay receipt is %s',
    async (mode) => {
      const fixture = await missingOrDamagedOverlay(mode)
      const { runtime, spawn } = setupLayoutOwnerRuntime()
      expect(canAshWriteProviderGlobalHooks()).toBe(false)
      const result = await runtime.createTerminal(`id:${WORKTREE_ID}`, {
        startupAgent: 'claude',
        presentation: 'background'
      })

      expect(result.ptyId).toBeTruthy()
      expect(spawn).toHaveBeenCalledTimes(1)
      const dispatched = spawn.mock.calls[0]?.[0]
      // The fixture's spawn mock is typed to the pane identity subset, but
      // the actual runtime passes a full PTY launch object.
      expect(dispatched).toEqual(
        expect.objectContaining({
          launchAgent: 'claude',
          command: expect.stringMatching(/claude/)
        })
      )
      expect(dispatched).not.toEqual(
        expect.objectContaining({ command: expect.stringContaining('--settings') })
      )
      expect(dispatched).not.toEqual(
        expect.objectContaining({ command: expect.stringContaining('--session-id') })
      )
      expect(existsSync(fixture.overlay.settingsPath)).toBe(true)
      expect(readFileSync(fixture.foreignSettings, 'utf8')).toBe(fixture.sentinel)
    }
  )
})
