import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { DEV_LAUNCHER_DIR } from './cli-install-constants'
import { escapeWindowsBatchValue, isAbsoluteForPlatform } from './cli-install-path-format'
import { quotePosixShellDoubleQuotedApostrophe } from '../../shared/shell/launch/shell-argument-quoting'

export async function ensureDevLauncher(args: {
  platform: NodeJS.Platform
  userDataPath: string
  execPath: string
  cliEntryPath: string
  commandName: string
}): Promise<string | null> {
  if (
    !isAbsoluteForPlatform(args.platform, args.execPath) ||
    !isAbsolute(args.cliEntryPath) ||
    !existsSync(args.cliEntryPath)
  ) {
    return null
  }

  const launcherPath = join(
    args.userDataPath,
    ...DEV_LAUNCHER_DIR,
    args.platform === 'win32' ? `${args.commandName}.cmd` : args.commandName
  )
  await mkdir(dirname(launcherPath), { recursive: true })

  // Why: dev builds lack the packaged resources/bin launcher, so generate one in userData to validate the flow.
  const content =
    args.platform === 'win32'
      ? buildWindowsDevLauncher(args.execPath, args.cliEntryPath, args.userDataPath)
      : buildUnixCliLauncher(args.execPath, args.cliEntryPath, args.userDataPath)
  await writeFile(launcherPath, content, {
    encoding: 'utf8',
    mode: args.platform === 'win32' ? undefined : 0o755
  })
  // Never create an Orca alias; the Ash-local PATH prefix must not hijack
  // another application's CLI or GNOME's Orca screen reader.
  return launcherPath
}

export function buildUnixCliLauncher(
  execPathValue: string,
  cliEntryPath: string,
  userDataPath: string,
  runtime: 'electron' | 'node' = 'electron'
): string {
  if (runtime === 'node') {
    return `#!/usr/bin/env sh
set -eu
export ASH_USER_DATA_PATH=${quotePosixShellDoubleQuotedApostrophe(userDataPath)}
export ORCA_USER_DATA_PATH="$ASH_USER_DATA_PATH"
unset NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE ELECTRON_RUN_AS_NODE
exec ${quotePosixShellDoubleQuotedApostrophe(execPathValue)} ${quotePosixShellDoubleQuotedApostrophe(cliEntryPath)} "$@"
`
  }
  return `#!/usr/bin/env bash
set -euo pipefail
ELECTRON=${quotePosixShellDoubleQuotedApostrophe(execPathValue)}
CLI=${quotePosixShellDoubleQuotedApostrophe(cliEntryPath)}
export ASH_USER_DATA_PATH=${quotePosixShellDoubleQuotedApostrophe(userDataPath)}
export ORCA_USER_DATA_PATH="$ASH_USER_DATA_PATH"
if [ -z "\${ASH_APP_EXECUTABLE:-}" ]; then
  export ASH_APP_EXECUTABLE="$ELECTRON"
  export ASH_APP_EXECUTABLE_NEEDS_APP_ROOT=1
fi
export ORCA_NODE_OPTIONS="\${NODE_OPTIONS-}"
export ORCA_NODE_REPL_EXTERNAL_MODULE="\${NODE_REPL_EXTERNAL_MODULE-}"
unset NODE_OPTIONS
unset NODE_REPL_EXTERNAL_MODULE
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"
`
}

export function buildWindowsDevLauncher(
  execPathValue: string,
  cliEntryPath: string,
  userDataPath: string
): string {
  return `@echo off
setlocal
set "ELECTRON=${escapeWindowsBatchValue(execPathValue)}"
set "CLI=${escapeWindowsBatchValue(cliEntryPath)}"
set "ASH_USER_DATA_PATH=${escapeWindowsBatchValue(userDataPath)}"
set "ORCA_USER_DATA_PATH=%ASH_USER_DATA_PATH%"
if not defined ASH_APP_EXECUTABLE (
  set "ASH_APP_EXECUTABLE=%ELECTRON%"
  set "ASH_APP_EXECUTABLE_NEEDS_APP_ROOT=1"
)
set "ORCA_NODE_OPTIONS=%NODE_OPTIONS%"
set "ORCA_NODE_REPL_EXTERNAL_MODULE=%NODE_REPL_EXTERNAL_MODULE%"
set NODE_OPTIONS=
set NODE_REPL_EXTERNAL_MODULE=
set ELECTRON_RUN_AS_NODE=1
"%ELECTRON%" "%CLI%" %*
`
}

export function buildWindowsForwarder(launcherPath: string): string {
  return `@echo off
setlocal
set "ASH_LAUNCHER=${escapeWindowsBatchValue(launcherPath)}"
"%ASH_LAUNCHER%" %*
`
}

export function extractManagedUnixLauncherTarget(content: string): string | null {
  if (
    !content.includes('ELECTRON_RUN_AS_NODE=1') ||
    !content.includes('ASH_USER_DATA_PATH=') ||
    !content.includes('ORCA_NODE_OPTIONS') ||
    !content.includes('NODE_REPL_EXTERNAL_MODULE')
  ) {
    return null
  }

  const cliPath = extractShellAssignment(content, 'CLI')
  if (!cliPath) {
    return null
  }

  // Only Ash-owned launchers count as managed; never reclaim Orca's scripts.
  return /(?:^|[/\\])(?:out|app\.asar\.unpacked[/\\]out)[/\\]cli[/\\]index\.js$/.test(cliPath)
    ? cliPath
    : null
}

export function extractShellAssignment(content: string, name: string): string | null {
  const match = new RegExp(`^${name}=('([^']*)'|"([^"]*)"|([^\\n]+))$`, 'm').exec(content)
  if (!match) {
    return null
  }
  return (match[2] ?? match[3] ?? match[4] ?? '').trim()
}
