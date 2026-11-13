import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOrcaManagedCodexHomePath,
  getOrcaUserDataPath,
  resolveOrcaManagedCodexHomePath
} from './codex-home-paths'

let fixture = ''
let orcaSentinel = ''

beforeEach(() => {
  fixture = mkdtempSync(join('/var/tmp', 'ash-codex-home-isolation-'))
  vi.stubEnv('HOME', fixture)
  vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
  vi.stubEnv('ASH_USER_DATA_PATH', undefined)
  vi.stubEnv('XDG_CONFIG_HOME', undefined)
  const orcaRoot = join(fixture, '.orca')
  mkdirSync(orcaRoot, { mode: 0o700 })
  orcaSentinel = join(orcaRoot, 'foreign-codex-state.txt')
  writeFileSync(orcaSentinel, 'Orca-owned state; preserve\n', { mode: 0o600 })
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(fixture, { recursive: true, force: true })
})

function expectOrcaUntouched(): void {
  expect(readFileSync(orcaSentinel, 'utf8')).toBe('Orca-owned state; preserve\n')
  expect(existsSync(join(fixture, '.orca', 'codex-runtime-home'))).toBe(false)
  expect(existsSync(join(fixture, '.config', 'orca', 'codex-runtime-home'))).toBe(false)
}

describe.skipIf(process.platform !== 'linux')('independent Ash Codex runtime home', () => {
  it('uses an Ash profile with no environment override; read-only resolution creates nothing', () => {
    expect(homedir()).toBe(fixture)
    expect(getOrcaUserDataPath()).toBe(join(fixture, '.config', 'ash-ide'))
    expect(resolveOrcaManagedCodexHomePath()).toBe(
      join(fixture, '.config', 'ash-ide', 'codex-runtime-home', 'home')
    )
    expect(existsSync(join(fixture, '.config', 'ash-ide'))).toBe(false)
    const home = getOrcaManagedCodexHomePath()
    expect(home).toBe(join(fixture, '.config', 'ash-ide', 'codex-runtime-home', 'home'))
    expect(existsSync(home)).toBe(true)
    expectOrcaUntouched()
  })

  it('preserves a selected Ash profile and the inherited runtime environment bridge', () => {
    const selected = join(fixture, 'explicit-Ash-profile')
    vi.stubEnv('ASH_USER_DATA_PATH', selected)
    expect(getOrcaUserDataPath()).toBe(selected)
    const bridge = join(fixture, 'headless-Ash-profile')
    vi.stubEnv('ORCA_USER_DATA_PATH', bridge)
    expect(getOrcaUserDataPath()).toBe(bridge)
    expect(getOrcaManagedCodexHomePath()).toBe(join(bridge, 'codex-runtime-home', 'home'))
    expect(existsSync(join(selected, 'codex-runtime-home'))).toBe(false)
    expectOrcaUntouched()
  })

  it('rejects an explicit Orca profile before materializing a Codex home', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', join(fixture, '.orca'))
    expect(() => getOrcaUserDataPath()).toThrow('ash_data_root_conflicts_with_orca')
    expect(() => getOrcaManagedCodexHomePath()).toThrow('ash_data_root_conflicts_with_orca')
    expectOrcaUntouched()
  })

  it('rejects an Orca profile reached through a symlink alias', () => {
    const alias = join(fixture, 'aliased-profile')
    symlinkSync(join(fixture, '.orca'), alias, 'dir')
    vi.stubEnv('ORCA_USER_DATA_PATH', alias)
    expect(() => getOrcaManagedCodexHomePath()).toThrow('ash_data_root_conflicts_with_orca')
    expectOrcaUntouched()
  })

  it('rejects a managed Codex child path redirected into Orca state', () => {
    const ash = join(fixture, '.config', 'ash-ide')
    mkdirSync(ash, { recursive: true, mode: 0o700 })
    const orcaCodex = join(fixture, '.orca', 'foreign-runtime-home')
    mkdirSync(orcaCodex, { mode: 0o700 })
    symlinkSync(orcaCodex, join(ash, 'codex-runtime-home'), 'dir')
    expect(() => getOrcaManagedCodexHomePath()).toThrow('ash_secret_key_path_escapes_profile')
    expect(existsSync(join(orcaCodex, 'home'))).toBe(false)
    expectOrcaUntouched()
  })

  it('rejects an unsafe alias in XDG_CONFIG_HOME rather than writing into Orca', () => {
    vi.stubEnv('XDG_CONFIG_HOME', join(fixture, '.orca'))
    expect(() => getOrcaManagedCodexHomePath()).toThrow('ash_data_root_conflicts_with_orca')
    expectOrcaUntouched()
  })
})
