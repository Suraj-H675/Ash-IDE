import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDefaultUserDataPath, getPlatformUserDataPath } from './metadata'
import { getMacOpenArgs } from './launch'
import { pinLaunchUserDataPath, resolveLaunchUserDataPath } from './launch-user-data-path'

describe('resolveLaunchUserDataPath', () => {
  it('uses Ash-specific packaged data locations', () => {
    expect(getPlatformUserDataPath('linux', '/home/tester')).toBe(
      join('/home/tester', '.config', 'ash-ide')
    )
    expect(getPlatformUserDataPath('darwin', '/Users/tester')).toBe(
      join('/Users/tester', 'Library', 'Application Support', 'ash-ide')
    )
  })

  it('does not inherit the Orca user data environment override', () => {
    const originalAshPath = process.env.ASH_USER_DATA_PATH
    const originalOrcaPath = process.env.ORCA_USER_DATA_PATH
    delete process.env.ASH_USER_DATA_PATH
    process.env.ORCA_USER_DATA_PATH = '/home/tester/.config/orca'
    try {
      expect(getDefaultUserDataPath('linux', '/home/tester')).toBe(
        join('/home/tester', '.config', 'ash-ide')
      )
    } finally {
      if (originalAshPath === undefined) {
        delete process.env.ASH_USER_DATA_PATH
      } else {
        process.env.ASH_USER_DATA_PATH = originalAshPath
      }
      if (originalOrcaPath === undefined) {
        delete process.env.ORCA_USER_DATA_PATH
      } else {
        process.env.ORCA_USER_DATA_PATH = originalOrcaPath
      }
    }
  })

  it('prefers ASH_USER_DATA_PATH, made absolute', () => {
    expect(
      resolveLaunchUserDataPath({
        ASH_USER_DATA_PATH: 'rel/profile',
        ASH_DEV_USER_DATA_PATH: '/dev',
        ASH_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      })
    ).toBe(resolve('rel/profile'))
  })

  it('ignores inherited Orca profile overrides', () => {
    expect(
      resolveLaunchUserDataPath({
        ORCA_USER_DATA_PATH: '/home/user/.config/orca',
        ORCA_DEV_USER_DATA_PATH: '/home/user/.config/orca-dev'
      })
    ).toBe(getPlatformUserDataPath())
  })

  it("falls back to the dev app's own profile for a dev executable", () => {
    expect(resolveLaunchUserDataPath({ ASH_APP_EXECUTABLE_NEEDS_APP_ROOT: '1' })).toBe(
      resolve(join(getPlatformUserDataPath(), '..', 'ash-ide-dev'))
    )
  })

  it('ignores ASH_DEV_USER_DATA_PATH for a packaged executable', () => {
    expect(resolveLaunchUserDataPath({ ASH_DEV_USER_DATA_PATH: '/dev' })).toBe(
      getPlatformUserDataPath()
    )
  })
})

describe('pinLaunchUserDataPath', () => {
  it('sets the dev override only for a dev executable', () => {
    expect(pinLaunchUserDataPath(['--no-sandbox'], {}, '/p')).toEqual({
      args: ['--no-sandbox', '--user-data-dir=/p'],
      env: { ASH_USER_DATA_PATH: '/p', ORCA_USER_DATA_PATH: '/p' }
    })
    expect(
      pinLaunchUserDataPath([], { ASH_APP_EXECUTABLE_NEEDS_APP_ROOT: '1' }, '/p').env
    ).toMatchObject({ ASH_DEV_USER_DATA_PATH: '/p' })
  })
})

describe('getMacOpenArgs', () => {
  it('reopens the bundle as before on the default profile', () => {
    expect(getMacOpenArgs('/Applications/Orca.app', getPlatformUserDataPath())).toEqual([
      '/Applications/Orca.app'
    ])
  })

  it('starts a new instance on another profile instead of activating the running app', () => {
    expect(getMacOpenArgs('/Applications/Orca.app', '/isolated/p')).toEqual([
      '-n',
      '/Applications/Orca.app',
      '--args',
      '--user-data-dir=/isolated/p'
    ])
  })
})
