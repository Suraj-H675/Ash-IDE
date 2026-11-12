import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ home: '', userData: '', exit: vi.fn() }))

vi.mock('electron', () => ({
  app: {
    exit: fixture.exit,
    getPath: (name: string) => (name === 'userData' ? fixture.userData : fixture.home),
    getAppPath: () => fixture.userData,
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: vi.fn(),
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn()
  },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./windows-app-data-path', () => ({ ensureWindowsAppDataPath: vi.fn() }))
vi.mock(import('node:os'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, homedir: () => fixture.home }
})

const APP_ENVIRONMENT_SLOT = Symbol.for('orca.host.appEnvironment')

beforeEach(() => {
  fixture.home = mkdtempSync(join(tmpdir(), 'orca-uninstall-hooks-home-'))
  fixture.userData = mkdtempSync(join(tmpdir(), 'orca-uninstall-hooks-data-'))
  fixture.exit.mockClear()
  // Every path the removers resolve from the environment stays in the fixture, on any runner.
  vi.stubEnv('HOME', fixture.home)
  vi.stubEnv('USERPROFILE', fixture.home)
  vi.stubEnv('ORCA_USER_DATA_PATH', fixture.userData)
  vi.stubEnv('XDG_CONFIG_HOME', join(fixture.home, '.config'))
  vi.stubEnv('APPDATA', join(fixture.home, 'AppData', 'Roaming'))
  vi.stubEnv('CODEX_HOME', join(fixture.home, '.codex'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  // The uninstaller launches a fresh process: nothing has installed the app environment yet.
  Reflect.set(globalThis, APP_ENVIRONMENT_SLOT, null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(fixture.home, { recursive: true, force: true })
  rmSync(fixture.userData, { recursive: true, force: true })
})

it('refuses inherited uninstall removal without populating provider-hook directories', async () => {
  const claudeDir = join(fixture.home, '.claude')
  const orcaHookDir = join(fixture.home, '.orca', 'agent-hooks')
  mkdirSync(claudeDir, { recursive: true })
  mkdirSync(orcaHookDir, { recursive: true })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  try {
    const { AGENT_HOOKS_UNINSTALL_FLAG, runAgentHooksUninstallPreflight } =
      await import('./agent-hooks-uninstall-preflight')
    expect(runAgentHooksUninstallPreflight(['Orca.exe', AGENT_HOOKS_UNINSTALL_FLAG])).toBe(true)

    await vi.waitFor(() => expect(fixture.exit).toHaveBeenCalled(), { timeout: 20_000 })
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uninstall left claude hooks'))
    expect(readdirSync(claudeDir)).toEqual([])
    expect(readdirSync(orcaHookDir)).toEqual([])
  } finally {
    warn.mockRestore()
  }
})
