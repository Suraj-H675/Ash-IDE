import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getBundledLauncherPath } from './bundled-cli-launcher-path'
import { DEV_COMMAND_NAME } from './cli-install-constants'
import { buildUnixCliLauncher, buildWindowsDevLauncher, ensureDevLauncher } from './cli-dev-launcher'
import { CliInstaller } from './cli-installer'

const created: string[] = []
afterEach(async () => {
  for (const root of created.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Ash CLI identity and source-app isolation', () => {
  it('uses unique packaged launcher names across all three platforms', () => {
    expect(getBundledLauncherPath('linux', '/p')).toBe('/p/bin/ash-ide')
    expect(getBundledLauncherPath('darwin', '/p')).toBe('/p/bin/ash-ide')
    expect(getBundledLauncherPath('win32', '/p')).toBe('/p/bin/ash-ide.exe')
    expect(DEV_COMMAND_NAME).toBe('ash-ide-dev')
  })

  it('generates only its own private developer CLI, without an orca alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-cli-identity-'))
    created.push(root)
    const profile = join(root, 'profile')
    const entry = join(root, 'cli.js')
    await mkdir(profile)
    await writeFile(entry, 'process.exit(0)\n')
    const file = await ensureDevLauncher({
      platform: 'linux', userDataPath: profile,
      execPath: '/usr/bin/node', cliEntryPath: entry, commandName: DEV_COMMAND_NAME
    })
    expect(file).toBe(join(profile, 'cli', 'bin', 'ash-ide-dev'))
    expect(await readdir(join(profile, 'cli', 'bin'))).toEqual(['ash-ide-dev'])
    const script = await readFile(file!, 'utf8')
    expect(script).toContain('export ASH_USER_DATA_PATH=')
    expect(script).toContain('export ASH_APP_EXECUTABLE=')
    expect(script).not.toContain('export ORCA_APP_EXECUTABLE=')
  })

  it('pins the Ash profile in Unix and Windows launchers', () => {
    const unix = buildUnixCliLauncher('/bin/electron', '/root/out/cli/index.js', '/tmp/ash-test')
    const windows = buildWindowsDevLauncher('C:\\electron.exe', 'C:\\ash\\cli.js', 'C:\\ash-test')
    expect(unix).toContain('export ASH_USER_DATA_PATH=')
    expect(unix).toContain('ASH_APP_EXECUTABLE')
    expect(windows).toContain('set "ASH_USER_DATA_PATH=')
    expect(windows).toContain('if not defined ASH_APP_EXECUTABLE')
    expect(windows).not.toContain('if not defined ORCA_APP_EXECUTABLE')
  })

  it('installs and removes only the Ash command, leaving a preexisting Orca command untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-cli-original-preservation-'))
    created.push(root)
    const homeBin = join(root, '.local', 'bin')
    const resources = join(root, 'resources')
    await mkdir(homeBin, { recursive: true })
    await mkdir(join(resources, 'bin'), { recursive: true })
    const originalOrca = '#!/bin/sh\necho ORCA_OWNED_COMMAND\n'
    await writeFile(join(homeBin, 'orca'), originalOrca, { mode: 0o755 })
    await writeFile(join(resources, 'bin', 'ash-ide'), '#!/bin/sh\n', { mode: 0o755 })

    const installer = new CliInstaller({
      platform: 'linux', isPackaged: true,
      userDataPath: join(root, 'ash-profile'),
      resourcesPath: resources, homePath: root,
      appPath: root, execPath: '/usr/bin/electron',
      appImagePath: null, processPathEnv: ''
    })
    const status = await installer.getStatus()
    expect(status.commandPath).toBe(join(homeBin, 'ash-ide'))
    expect(status.state).toBe('not_installed')
    expect((await installer.install()).state).toBe('installed')
    expect(await readFile(join(homeBin, 'orca'), 'utf8')).toBe(originalOrca)
    expect((await installer.remove()).state).toBe('not_installed')
    expect(await readFile(join(homeBin, 'orca'), 'utf8')).toBe(originalOrca)
  })
})
