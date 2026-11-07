import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dropInheritedDevInstanceEnv,
  getSharedDevUserDataPath,
  resolveDevCliUserDataPath,
  resolveDevProfile
} from './dev-instance-isolation.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Ash development profile isolation', () => {
  it('ignores inherited Orca profile paths when selecting Ash defaults', () => {
    const env = {
      HOME: '/home/tester',
      ORCA_USER_DATA_PATH: '/home/tester/.config/orca',
      ORCA_DEV_USER_DATA_PATH: '/home/tester/.config/orca-dev'
    }

    expect(resolveDevProfile({ repoRoot: '/work/Ash-IDE', env, platform: 'linux' })).toEqual({
      kind: 'shared',
      userDataPath: '/home/tester/.config/ash-ide-dev'
    })
  })

  it('drops a parent Ash profile and identity when a nested checkout differs', () => {
    const env = {
      ASH_DEV_REPO_ROOT: '/work/parent',
      ASH_DEV_USER_DATA_PATH: '/home/tester/.config/ash-ide-dev-wt/parent',
      ASH_USER_DATA_PATH: '/home/tester/.config/ash-ide-dev-wt/parent',
      ASH_DEV_INSTANCE_KEY: 'parent',
      ORCA_DEV_REPO_ROOT: '/work/parent',
      ORCA_DEV_INSTANCE_KEY: 'parent'
    }

    dropInheritedDevInstanceEnv(env, '/work/child')

    expect(env.ASH_DEV_USER_DATA_PATH).toBeUndefined()
    expect(env.ASH_DEV_INSTANCE_KEY).toBeUndefined()
    expect(env.ORCA_DEV_REPO_ROOT).toBeUndefined()
    expect(env.ORCA_DEV_INSTANCE_KEY).toBeUndefined()
  })

  it('resolves the dev CLI profile under Ash data even when the parent exports Orca paths', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ash-dev-profile-'))
    roots.push(root)
    const env = {
      HOME: root,
      ORCA_USER_DATA_PATH: path.join(root, '.config', 'orca'),
      ORCA_DEV_USER_DATA_PATH: path.join(root, '.config', 'orca-dev')
    }

    expect(resolveDevCliUserDataPath({ repoRoot: path.join(root, 'Ash-IDE'), env })).toBe(
      getSharedDevUserDataPath(env, process.platform)
    )
  })
})
