import { describe, expect, it, vi } from 'vitest'
import { createCodexRuntimeHomeLaunchPreparation } from './codex-runtime-home-launch-preparation'

describe('Ash Codex launch preparation', () => {
  it('uses the existing provider home without synchronizing managed auth or config', async () => {
    const getRuntimeHome = vi.fn(() => ({ prepareForCodexLaunchAsync: vi.fn() }) as never)
    const getSettings = vi.fn(() => undefined)
    const prepare = createCodexRuntimeHomeLaunchPreparation({ getRuntimeHome, getSettings })

    await expect(
      prepare({ runtime: 'host' }, { CODEX_HOME: '/provider/codex-home' }, { launchesCodex: true })
    ).resolves.toBeNull()

    expect(getRuntimeHome).not.toHaveBeenCalled()
    expect(getSettings).not.toHaveBeenCalled()
  })
})
