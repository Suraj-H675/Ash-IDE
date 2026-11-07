#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareDevCliTerminalWrappers } from './dev-cli-terminal-wrapper.mjs'
import { resolveDevCliUserDataPath } from '../instance-isolation/dev-instance-isolation.mjs'

export function resolveAshDevLaunchPlan({
  scriptPath = import.meta.filename,
  env = process.env,
  platform = process.platform
} = {}) {
  const resolvedScriptPath = realpathSync(scriptPath)
  const repoRoot = path.resolve(path.dirname(resolvedScriptPath), '..', '..', '..', '..')
  const cliEntry = env.ASH_DEV_CLI_ENTRY_PATH ?? path.join(repoRoot, 'out', 'cli', 'index.js')
  const launchEnv = { ...env }
  const userDataPath = resolveDevCliUserDataPath({
    repoRoot,
    env: launchEnv,
    platform
  })
  const electronExecutable =
    platform === 'win32'
      ? path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
      : path.join(repoRoot, 'node_modules', '.bin', 'electron')
  return {
    repoRoot,
    cliEntry,
    userDataPath,
    electronExecutable,
    env: {
      ...launchEnv,
      ASH_USER_DATA_PATH: userDataPath,
      ORCA_USER_DATA_PATH: userDataPath,
      ORCA_DEV_CLI_INVOCATION: '1',
      ASH_APP_EXECUTABLE: electronExecutable,
      ASH_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
    }
  }
}

function runAshDevCli() {
  const plan = resolveAshDevLaunchPlan()
  try {
    realpathSync(plan.cliEntry)
  } catch {
    console.error("ash-ide-dev: CLI not built yet. Run 'pnpm run build:cli' first.")
    process.exit(1)
  }

  Object.assign(process.env, plan.env)

  // Headless `ash-ide-dev serve` skips the Electron dev runner that normally installs terminal CLI shims.
  prepareDevCliTerminalWrappers({
    repoRoot: plan.repoRoot,
    userDataPath: plan.userDataPath,
    electronExecutable: plan.electronExecutable
  })

  const result = spawnSync(process.execPath, [plan.cliEntry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
  })

  if (result.signal) {
    process.kill(process.pid, result.signal)
  }
  process.exit(result.status ?? (result.error ? 1 : 0))
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  runAshDevCli()
}

