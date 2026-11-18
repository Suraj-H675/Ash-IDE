#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const SUPPORTED_ARCHES = new Set(['x64', 'arm64'])
const DEFAULT_LINUX_TARGETS = ['AppImage', 'deb', 'rpm']
const SUPPORTED_LINUX_TARGETS = new Set(DEFAULT_LINUX_TARGETS)

/** Keep AppImage builds independent of optional DEB/RPM toolchains on Linux hosts. */
export function resolveLinuxBuildTargets(requested) {
  if (requested === undefined) {
    return [...DEFAULT_LINUX_TARGETS]
  }
  const targets = requested.split(',').map((target) => target.trim())
  if (
    targets.some((target) => !SUPPORTED_LINUX_TARGETS.has(target)) ||
    new Set(targets).size !== targets.length
  ) {
    throw new Error(
      `Unsupported Linux package targets: ${requested}. Use a unique comma-separated subset of AppImage,deb,rpm.`
    )
  }
  return targets
}

/** Select the local Linux package architecture without relying on builder defaults. */
export function resolveLinuxBuildArch({
  platform = process.platform,
  hostArch = process.arch,
  requestedArch = process.env.ORCA_LINUX_BUILD_ARCH
} = {}) {
  const arch = requestedArch ?? (platform === 'linux' ? hostArch : 'x64')
  if (!SUPPORTED_ARCHES.has(arch)) {
    throw new Error(
      `Unsupported Linux build architecture: ${arch}. Use ORCA_LINUX_BUILD_ARCH=x64|arm64.`
    )
  }
  return arch
}

export function buildLinuxElectronBuilderArgs(
  arch,
  extraArgs = [],
  targets = resolveLinuxBuildTargets()
) {
  if (!SUPPORTED_ARCHES.has(arch)) {
    throw new Error(`Unsupported Linux build architecture: ${arch}`)
  }
  return [
    'exec',
    'electron-builder',
    '--config',
    'config/electron-builder.config.cjs',
    '--linux',
    ...targets,
    `--${arch}`,
    ...extraArgs
  ]
}

export function runLocalLinuxBuild({
  arch = resolveLinuxBuildArch(),
  extraArgs = [],
  environment = process.env,
  targets = resolveLinuxBuildTargets(environment.ASH_LINUX_PACKAGE_TARGETS),
  execFile = execFileSync,
  platform = process.platform,
  cwd = resolve(import.meta.dirname, '../../../..')
} = {}) {
  const env = { ...environment }
  if (arch === 'arm64') {
    env.ORCA_LINUX_ARM64_RELEASE = '1'
  } else {
    delete env.ORCA_LINUX_ARM64_RELEASE
  }
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  execFile(pnpm, buildLinuxElectronBuilderArgs(arch, extraArgs, targets), {
    cwd,
    env,
    stdio: 'inherit'
  })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  runLocalLinuxBuild({ extraArgs: process.argv.slice(2) })
}
