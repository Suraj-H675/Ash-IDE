import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAshDevLaunchPlan } from './ash-dev.mjs'

const projectDir = path.resolve(import.meta.dirname, '../../../..')
const wrapperPath = path.join(
  projectDir,
  'config',
  'scripts',
  'development',
  'launch',
  'ash-dev.mjs'
)

describe('ash-ide-dev package bin', () => {
  it('resolves the installed CLI and Ash profile from the launcher location', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ash-ide-dev-installed-'))
    try {
      const installedLauncher = path.join(
        root,
        'config/scripts/development/launch/ash-dev.mjs'
      )
      mkdirSync(path.dirname(installedLauncher), { recursive: true })
      copyFileSync(wrapperPath, installedLauncher)
      const userDataPath = path.join(root, 'profile')
      const plan = resolveAshDevLaunchPlan({
        scriptPath: installedLauncher,
        env: {
          ...process.env,
          ASH_DEV_CLI_ENTRY_PATH: undefined,
          ASH_DEV_USER_DATA_PATH: userDataPath,
          ASH_USER_DATA_PATH: undefined,
          ORCA_USER_DATA_PATH: '/home/tester/.config/orca',
          ASH_APP_EXECUTABLE: path.join(root, 'Old Ash.app')
        },
        platform: 'linux'
      })

      expect(plan.repoRoot).toBe(root)
      expect(plan.cliEntry).toBe(path.join(root, 'out', 'cli', 'index.js'))
      expect(plan.userDataPath).toBe(userDataPath)
      expect(plan.env.ASH_USER_DATA_PATH).toBe(userDataPath)
      expect(plan.env.ORCA_USER_DATA_PATH).toBe(userDataPath)
      expect(plan.env.ASH_APP_EXECUTABLE).toBe(path.join(root, 'node_modules/.bin/electron'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('runs the dev CLI through Node without requiring Bash', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ash-ide-dev-bin-'))
    const cliEntry = path.join(root, 'cli-entry.cjs')
    const outputPath = path.join(root, 'output.json')
    writeFileSync(
      cliEntry,
      [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({`,
        '  argv: process.argv.slice(2),',
        '  ashUserDataPath: process.env.ASH_USER_DATA_PATH,',
        '  userDataPath: process.env.ORCA_USER_DATA_PATH,',
        '  devCliInvocation: process.env.ORCA_DEV_CLI_INVOCATION,',
        '  appExecutable: process.env.ASH_APP_EXECUTABLE',
        '}));'
      ].join('\n'),
      'utf8'
    )
    if (process.platform !== 'win32') {
      chmodSync(cliEntry, 0o755)
    }

    execFileSync(process.execPath, [wrapperPath, '--help'], {
      env: {
        ...process.env,
        ASH_DEV_CLI_ENTRY_PATH: cliEntry,
        ASH_DEV_USER_DATA_PATH: path.join(root, 'user-data'),
        ASH_APP_EXECUTABLE: path.join(root, 'Electron')
      },
      stdio: 'ignore'
    })

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      argv: ['--help'],
      ashUserDataPath: path.join(root, 'user-data'),
      userDataPath: path.join(root, 'user-data'),
      devCliInvocation: '1',
      appExecutable:
        process.platform === 'win32'
          ? path.join(projectDir, 'node_modules', 'electron', 'dist', 'electron.exe')
          : path.join(projectDir, 'node_modules', '.bin', 'electron')
    })
  })
})
