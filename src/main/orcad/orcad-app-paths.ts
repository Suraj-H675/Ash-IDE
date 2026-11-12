// Return real Node-host paths or throw: plausible catch-all directories can be forked as executables.
import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import type { AppPathName } from '../../shared/app-environment'

// Empty exported paths remain unset.
function env(name: string): string | null {
  const value = process.env[name]
  return value ? value : null
}

type AshDataPathContext = {
  environment?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
}

// Resolve the longest existing prefix so an Ash profile symlink cannot quietly
// point into a different application's credential or session directory.
function physicalPath(path: string): string {
  const missing: string[] = []
  let parent = resolve(path)
  for (;;) {
    try {
      return resolve(realpathSync(parent), ...missing)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      const next = dirname(parent)
      if (next === parent) {
        throw error
      }
      missing.unshift(basename(parent))
      parent = next
    }
  }
}

/** Resolve symbolic parents before trusting a data/key location. */
export function physicalAshDataPath(path: string): string {
  return physicalPath(path)
}

export function assertAshUserDataPathIsIndependent(
  userDataPath: string,
  context: AshDataPathContext = {}
): void {
  const environment = context.environment ?? process.env
  const homeDir = context.homeDir ?? homedir()
  const platform = context.platform ?? process.platform
  if (!isAbsolute(userDataPath)) {
    throw new Error('ash_user_data_path_must_be_absolute')
  }
  const canonical = physicalPath(userDataPath)
  const excluded = [
    homeDir,
    join(homeDir, '.orca'),
    join(environment.XDG_DATA_HOME || join(homeDir, '.local', 'share'), 'Orca'),
    join(environment.XDG_CONFIG_HOME || join(homeDir, '.config'), 'orca'),
    join(homeDir, 'Library', 'Application Support', 'Orca'),
    join(environment.APPDATA || join(homeDir, 'AppData', 'Roaming'), 'Orca')
  ]
  const name = (path: string): string =>
    platform === 'win32' || platform === 'darwin' ? path.toLocaleLowerCase('en-US') : path
  const target = name(canonical)
  const physicalHome = name(physicalPath(homeDir))
  if (
    target === name(physicalPath(resolve(sep))) ||
    physicalHome.startsWith(`${target}${sep}`) ||
    excluded.some((root) => {
      const source = name(physicalPath(root))
      return (
        target === source ||
        (source !== physicalHome &&
          (target.startsWith(`${source}${sep}`) || source.startsWith(`${target}${sep}`)))
      )
    })
  ) {
    throw new Error('ash_data_root_conflicts_with_orca — use a separate Ash-owned profile')
  }
}

/** Key storage must remain inside the resolved Ash profile even through symlinks. */
export function assertAshOwnedChildPath(userDataPath: string, childPath: string): void {
  assertAshUserDataPathIsIndependent(userDataPath)
  const suffix = relative(physicalPath(userDataPath), physicalPath(childPath))
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error('ash_secret_key_path_escapes_profile')
  }
}

/** Ash's standalone runtime must never inherit Orca's profile selection. */
export function resolveUserDataPath(context: AshDataPathContext = {}): string {
  const environment = context.environment ?? process.env
  const homeDir = context.homeDir ?? homedir()
  const platform = context.platform ?? process.platform
  const explicit = environment.ASH_USER_DATA_PATH
  let userDataPath: string
  if (explicit) {
    userDataPath = explicit
  } else if (platform === 'darwin') {
    userDataPath = join(homeDir, 'Library', 'Application Support', 'ash-ide')
  } else if (platform === 'win32') {
    if (!environment.APPDATA) {
      throw new Error('ash_user_data_path_unavailable — APPDATA is not set')
    }
    userDataPath = join(environment.APPDATA, 'ash-ide')
  } else {
    userDataPath = join(environment.XDG_CONFIG_HOME || join(homeDir, '.config'), 'ash-ide')
  }
  assertAshUserDataPathIsIndependent(userDataPath, { environment, homeDir, platform })
  return userDataPath
}

function resolveAppDataPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support')
  }
  if (process.platform === 'win32') {
    return env('APPDATA') ?? join(homedir(), 'AppData', 'Roaming')
  }
  return env('XDG_CONFIG_HOME') ?? join(homedir(), '.config')
}

/** Resolve bundle siblings beside the real entry script; cwd and symlink locations can be unrelated. */
export function resolveOrcadInstallRoot(scriptPath = process.argv[1]): string {
  if (!scriptPath) {
    throw new Error(
      'orcad_install_root_unavailable — process.argv[1] is unset, so this process has no ' +
        'bundle root to resolve sibling entry points against'
    )
  }
  const absolute = resolve(scriptPath)
  let script = absolute
  try {
    script = realpathSync(absolute)
  } catch {
    // Missing scripts still establish a directory; sibling lookups diagnose missing resources.
  }
  return dirname(script)
}

export function resolveOrcadPath(name: AppPathName): string {
  switch (name) {
    case 'userData':
      return resolveUserDataPath()
    case 'home':
      return homedir()
    case 'temp':
      return tmpdir()
    case 'appData':
      return resolveAppDataPath()
    // Keep headless state in one removable userData tree; service accounts may lack macOS Library.
    case 'logs':
      return join(resolveUserDataPath(), 'logs')
    case 'exe':
      return process.execPath
    case 'downloads':
      return env('XDG_DOWNLOAD_DIR') ?? join(homedir(), 'Downloads')
  }
}
