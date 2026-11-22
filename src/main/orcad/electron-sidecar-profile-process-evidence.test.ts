import { describe, expect, it } from 'vitest'
import {
  classifyPosixProcessSnapshot,
  classifyWindowsProcessRows
} from './electron-sidecar-profile-process-evidence'
import type { WindowsProcessRow } from '../windows/windows-process-table'
import { parseCompleteWindowsCimProcessRows } from '../windows/windows-process-table-cim-scan'

describe('Electron sidecar profile process evidence', () => {
  it('requires every POSIX process row to parse before proving absence', () => {
    expect(classifyPosixProcessSnapshot('  1 launchd\n  42 /usr/bin/other', '/tmp/profile')).toBe(
      'absent'
    )
    expect(
      classifyPosixProcessSnapshot('  42 /opt/orca --user-data-dir=/tmp/profile', '/tmp/profile')
    ).toBe('in-use')
    expect(classifyPosixProcessSnapshot('  0 idle', '/tmp/profile')).toBe('unknown')
    expect(classifyPosixProcessSnapshot('  42 /opt/orca\npartial output', '/tmp/profile')).toBe(
      'unknown'
    )
    expect(classifyPosixProcessSnapshot('', '/tmp/profile')).toBe('unknown')
  })

  it('preserves when Windows cannot read a candidate Electron command line', () => {
    const unrelated: WindowsProcessRow = {
      pid: 5,
      ppid: 1,
      name: 'other.exe',
      command: 'other.exe'
    }
    const unreadableSidecar: WindowsProcessRow = {
      pid: 6,
      ppid: 1,
      name: 'Ash.exe',
      command: 'Ash.exe'
    }
    const liveSidecar: WindowsProcessRow = {
      pid: 7,
      ppid: 1,
      name: 'Ash.exe',
      command: '"C:\\Program Files\\Ash\\Ash.exe" --user-data-dir=C:\\Temp\\orcad-browser-x'
    }

    expect(classifyWindowsProcessRows([unrelated], 'C:\\Temp\\orcad-browser-x')).toBe('absent')
    expect(
      classifyWindowsProcessRows([unreadableSidecar], 'C:\\Temp\\orcad-browser-x', 'Ash.exe')
    ).toBe('unknown')
    expect(classifyWindowsProcessRows([liveSidecar], 'C:\\Temp\\orcad-browser-x')).toBe('in-use')
    expect(classifyWindowsProcessRows([], 'C:\\Temp\\orcad-browser-x')).toBe('unknown')
  })

  it('rejects partial or malformed Windows process snapshots', () => {
    expect(
      parseCompleteWindowsCimProcessRows(
        '[{"ProcessId":1,"ParentProcessId":0,"Name":"System","CommandLine":null}]'
      )
    ).toEqual([{ pid: 1, ppid: 0, name: 'System', command: 'System' }])
    expect(
      parseCompleteWindowsCimProcessRows(
        '[{"ProcessId":1,"ParentProcessId":0,"Name":"System","CommandLine":3}]'
      )
    ).toBeNull()
    expect(
      parseCompleteWindowsCimProcessRows(
        '[{"ProcessId":"1x","ParentProcessId":0,"Name":"System","CommandLine":""}]'
      )
    ).toBeNull()
  })
})
