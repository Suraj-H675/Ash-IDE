import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import { RuntimeMachineName } from './hosts/platform-probe/runtime-machine-name'
import { describeScreenRuledAgentTranscripts } from './screen-ruled-agent-transcript-suite'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: () => null },
  webContents: { fromId: () => null },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: () => tmpdir() }
}))

describe('terminal readiness from recorded output', () => {
  beforeEach(() => {
    vi.spyOn(RuntimeMachineName.prototype, 'start').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Cline', () => {
    describeScreenRuledAgentTranscripts({
      agent: 'cline',
      foregroundProcess: 'cline',
      ready: [{ name: 'cline-3-0-66-ready', cols: 120, rows: 40, what: 'empty composer' }],
      notReady: [{ name: 'cline-3-0-66-permission', cols: 120, rows: 40, what: 'approval prompt' }],
      readyWithoutScreen: ['cline-3-0-66-ready']
    })
  })

  describe('Prime Agent', () => {
    describeScreenRuledAgentTranscripts({
      agent: 'prime-agent',
      foregroundProcess: 'prime-agent',
      ready: [{ name: 'prime-agent-0-9-8-ready', cols: 120, rows: 40, what: 'empty composer' }],
      notReady: [
        {
          name: 'prime-agent-0-9-8-trace-question',
          cols: 120,
          rows: 40,
          what: 'first-run question'
        }
      ],
      readyWithoutScreen: ['prime-agent-0-9-8-ready']
    })
  })
})
