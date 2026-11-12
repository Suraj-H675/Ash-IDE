import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getUserKeybindingsPath } from './keybinding-file'
import { writeJsonDocument } from './keybinding-file-parser'
import { KeybindingService } from './keybinding-service'

let home = ''
let ashProfile = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ash-keybinding-isolation-'))
  ashProfile = join(home, 'ash-profile')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('Ash keyboard-shortcut storage is independent of Orca', () => {
  it('uses Ash-owned userData and retains legacy shortcuts from Ash settings only', () => {
    const orca = join(home, '.orca')
    mkdirSync(orca)
    const foreign = join(orca, 'keybindings.json')
    writeFileSync(foreign, '{"foreign":"do not import"}\n', { mode: 0o644 })
    const service = new KeybindingService({
      userDataPath: ashProfile,
      homePath: home,
      platform: 'linux',
      getLegacyOverrides: () => ({ 'tab.newTerminal': ['Ctrl+Alt+Y'] })
    })
    expect(service.getPath()).toBe(join(ashProfile, 'keybindings.json'))
    expect(service.getSnapshot().overrides['tab.newTerminal']).toEqual(['Ctrl+Alt+Y'])
    service.ensureFile()
    expect(existsSync(service.getPath())).toBe(true)
    expect(readFileSync(foreign, 'utf8')).toBe('{"foreign":"do not import"}\n')
    expect(statSync(foreign).mode & 0o777).toBe(0o644)
  })

  it('rejects a symlink from the Ash profile into the foreign Orca directory', () => {
    const orca = join(home, '.orca')
    mkdirSync(orca)
    symlinkSync(orca, ashProfile, 'dir')
    expect(() => getUserKeybindingsPath(ashProfile, home)).toThrow(
      'ash_data_root_conflicts_with_orca'
    )
    expect(existsSync(join(orca, 'keybindings.json'))).toBe(false)
  })

  it('refuses linked foreign shortcut files even after a cached snapshot', () => {
    const service = new KeybindingService({ userDataPath: ashProfile, homePath: home })
    service.ensureFile()
    const path = service.getPath()
    service.getSnapshot()
    const foreign = join(home, '.orca', 'keybindings.json')
    mkdirSync(join(home, '.orca'))
    writeFileSync(foreign, '{"foreign":"unchanged"}', { mode: 0o644 })
    rmSync(path)
    symlinkSync(foreign, path)
    expect(() => service.getSnapshot()).toThrow()
    expect(() => service.ensureFile()).toThrow()
    expect(() => service.setActionBindings('tab.newTerminal', ['Ctrl+Alt+Y'])).toThrow()
    rmSync(path)
    linkSync(foreign, path)
    expect(() => service.reload()).toThrow('ash_keybindings_file_not_private')
    expect(readFileSync(foreign, 'utf8')).toBe('{"foreign":"unchanged"}')
    expect(statSync(foreign).mode & 0o777).toBe(0o644)
  })

  it('does not follow an attacker-planted predictable staging symlink', () => {
    mkdirSync(ashProfile)
    const foreign = join(home, '.orca', 'keybindings.json')
    mkdirSync(join(home, '.orca'))
    writeFileSync(foreign, '{"foreign":"unchanged"}', { mode: 0o644 })
    const path = join(ashProfile, 'keybindings.json')
    symlinkSync(foreign, `${path}.tmp`)
    writeJsonDocument(path, { version: 1, keybindings: {} })
    expect(readFileSync(foreign, 'utf8')).toBe('{"foreign":"unchanged"}')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1 })
  })
})
