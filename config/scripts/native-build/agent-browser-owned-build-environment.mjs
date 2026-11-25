import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { fail, resolveInputDirectory } from './agent-browser-owned-source-files.mjs'
import {
  assertSafeDirectoryPath,
  captureExecutableIdentity,
  resolveExecutableFile,
  writeToolWrappers
} from './agent-browser-owned-process.mjs'
import { copyCacheTree } from './agent-browser-owned-cache-copy.mjs'

export { copyCacheTree }

function createPrivateDirectory(path) {
  mkdirSync(path, { mode: 0o700 })
  chmodSync(path, 0o700)
  return path
}

function requiredToolPaths(tools) {
  const entries = {
    node: tools.node,
    pnpm: tools.pnpm,
    cargo: tools.cargo,
    rustc: tools.rustc,
    rustdoc: tools.rustdoc,
    cc: tools.cc,
    cxx: tools.cxx,
    ld: tools.linker,
    ar: tools.ar,
    'pkg-config': tools.pkgConfig,
    git: tools.git,
    tar: tools.tar,
    sh: tools.sh,
    env: tools.env
  }
  const verified = {}
  for (const [name, path] of Object.entries(entries)) {
    verified[name] = resolveExecutableFile(path, name)
  }
  for (const [name, path] of Object.entries(tools.optional ?? {})) {
    if (!path) {
      continue
    }
    if (!/^[A-Za-z0-9+._-]+$/.test(name)) {
      fail(`Tool wrapper name is invalid: ${name}`)
    }
    verified.optional ??= {}
    verified.optional[name] = resolveExecutableFile(path, name)
  }
  return verified
}

export function buildEnvironment(workspacePath, tools) {
  const workspace = resolveInputDirectory(workspacePath, 'Private workspace')
  const boundary = assertSafeDirectoryPath(workspace, 'Private workspace')
  const workspaceStat = lstatSync(workspace)
  if (boundary.directories.at(-1).uid !== userInfo().uid || (workspaceStat.mode & 0o077) !== 0) {
    fail('Private workspace must be owned by the current user and exclude group and other users.')
  }
  const toolPaths = requiredToolPaths(tools)
  const paths = {
    home: createPrivateDirectory(join(workspace, 'home')),
    temp: createPrivateDirectory(join(workspace, 'tmp')),
    cargoHome: createPrivateDirectory(join(workspace, 'cargo-home')),
    cargoTarget: createPrivateDirectory(join(workspace, 'cargo-target')),
    pnpmHome: createPrivateDirectory(join(workspace, 'pnpm-home')),
    privatePnpmStore: join(workspace, 'pnpm-store'),
    npmCache: createPrivateDirectory(join(workspace, 'npm-cache')),
    corepackHome: createPrivateDirectory(join(workspace, 'corepack-home')),
    xdgCache: createPrivateDirectory(join(workspace, 'xdg-cache')),
    xdgConfig: createPrivateDirectory(join(workspace, 'xdg-config')),
    xdgData: createPrivateDirectory(join(workspace, 'xdg-data')),
    xdgRuntime: createPrivateDirectory(join(workspace, 'xdg-runtime')),
    toolBin: createPrivateDirectory(join(workspace, 'tool-bin'))
  }
  paths.pnpmBin = createPrivateDirectory(join(paths.pnpmHome, 'bin'))

  const wrappers = Object.fromEntries(
    Object.entries(toolPaths).filter(([name]) => name !== 'optional')
  )
  Object.assign(wrappers, toolPaths.optional ?? {})
  writeToolWrappers(paths.toolBin, wrappers, toolPaths.sh)
  const wrapperIdentities = Object.fromEntries(
    Object.keys(wrappers).map((name) => [
      name,
      captureExecutableIdentity(join(paths.toolBin, name), `${name} tool wrapper`)
    ])
  )

  const npmConfig = join(paths.home, '.npmrc')
  const cargoConfig = join(paths.cargoHome, 'config.toml')
  const gitConfig = join(paths.home, '.gitconfig')
  writeFileSync(npmConfig, 'offline=true\nupdate-notifier=false\naudit=false\nfund=false\n', {
    mode: 0o600
  })
  chmodSync(npmConfig, 0o600)
  writeFileSync(cargoConfig, '[net]\noffline = true\n\n[build]\njobs = 1\n', { mode: 0o600 })
  chmodSync(cargoConfig, 0o600)
  writeFileSync(gitConfig, '', { mode: 0o600 })
  chmodSync(gitConfig, 0o600)

  const env = Object.freeze({
    HOME: paths.home,
    USERPROFILE: paths.home,
    TMPDIR: paths.temp,
    TMP: paths.temp,
    TEMP: paths.temp,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_DATA_HOME: paths.xdgData,
    XDG_RUNTIME_DIR: paths.xdgRuntime,
    PATH: paths.toolBin,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    CARGO: toolPaths.cargo,
    CARGO_HOME: paths.cargoHome,
    CARGO_TARGET_DIR: paths.cargoTarget,
    CARGO_NET_OFFLINE: 'true',
    CARGO_INCREMENTAL: '0',
    CARGO_BUILD_JOBS: '1',
    CARGO_PROFILE_RELEASE_DEBUG: '0',
    CARGO_TERM_COLOR: 'never',
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER: toolPaths.cc,
    RUSTC: toolPaths.rustc,
    RUSTDOC: toolPaths.rustdoc,
    CC: toolPaths.cc,
    CXX: toolPaths.cxx,
    AR: toolPaths.ar,
    PKG_CONFIG: toolPaths['pkg-config'],
    COREPACK_HOME: paths.corepackHome,
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    PNPM_HOME: paths.pnpmBin,
    npm_config_userconfig: npmConfig,
    npm_config_cache: paths.npmCache,
    npm_config_store_dir: paths.privatePnpmStore,
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    NEXT_TELEMETRY_DISABLED: '1'
  })
  return { env, paths, tools: toolPaths, wrapperIdentities }
}

export function copyBuildCaches(
  environment,
  cargoRegistryPath,
  pnpmStorePath,
  pnpmPolicyCachePath
) {
  const cargoRegistry = resolveInputDirectory(cargoRegistryPath, 'Cargo registry cache')
  const pnpmStore = resolveInputDirectory(pnpmStorePath, 'pnpm store')
  const privateRegistry = join(environment.paths.cargoHome, 'registry')
  copyCacheTree(cargoRegistry, privateRegistry, 'Cargo registry cache')
  // Cargo creates this standard cache marker on first use. Initialize it
  // before input snapshots rather than exempting registry mutations.
  try {
    writeFileSync(
      join(privateRegistry, 'CACHEDIR.TAG'),
      'Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n# For information about cache directory tags see https://bford.info/cachedir/\n',
      { flag: 'wx', mode: 0o600 }
    )
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error
    }
  }
  copyCacheTree(pnpmStore, environment.paths.privatePnpmStore, 'pnpm store')
  if (pnpmPolicyCachePath) {
    copyCacheTree(
      pnpmPolicyCachePath,
      join(environment.paths.xdgCache, 'pnpm'),
      'Pnpm policy cache'
    )
  }
}
