import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildLinuxElectronBuilderArgs,
  resolveLinuxBuildArch,
  resolveLinuxBuildTargets,
  runLocalLinuxBuild
} from './build-linux-local.mjs'

describe('Ash Linux package target selection', () => {
  it('creates the CLI package boundary during asset builds without installing a global dev CLI', () => {
    const scripts = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../../package.json'), 'utf8')
    ).scripts
    expect(scripts['build:cli:assets']).toContain(
      'verify-cli-bin.mjs --fix-executable --fix-package-json'
    )
    expect(scripts['build:cli:assets']).not.toContain('prepare:cli-output')
    expect(scripts['build:linux:appimage']).toBe(
      'ASH_LINUX_PACKAGE_TARGETS=AppImage pnpm run build:linux'
    )
  })

  it('preserves the full set of Linux targets unless explicitly restricted', () => {
    expect(resolveLinuxBuildTargets()).toEqual(['AppImage', 'deb', 'rpm'])
    expect(
      buildLinuxElectronBuilderArgs('x64', ['--publish', 'never'], ['AppImage', 'deb', 'rpm'])
    ).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'config/electron-builder.config.cjs',
      '--linux',
      'AppImage',
      'deb',
      'rpm',
      '--x64',
      '--publish',
      'never'
    ])
  })

  it('allows a standalone AppImage build without DEB/RPM targets', () => {
    expect(resolveLinuxBuildTargets('AppImage')).toEqual(['AppImage'])
    expect(buildLinuxElectronBuilderArgs('x64', [], ['AppImage'])).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'config/electron-builder.config.cjs',
      '--linux',
      'AppImage',
      '--x64'
    ])
  })

  it('rejects unknown, empty and duplicate targets instead of silently skipping packages', () => {
    for (const requested of ['', 'AppImage,', 'AppImage,AppImage', 'Appimage', 'zip']) {
      expect(() => resolveLinuxBuildTargets(requested)).toThrow(/Unsupported Linux package targets/)
    }
    expect(resolveLinuxBuildTargets('deb, rpm')).toEqual(['deb', 'rpm'])
  })

  it('respects the injected environment without altering the caller environment', () => {
    const execFile = vi.fn()
    const environment = { ASH_LINUX_PACKAGE_TARGETS: 'AppImage', ORCA_LINUX_ARM64_RELEASE: '1' }
    runLocalLinuxBuild({
      arch: 'x64',
      cwd: '/disposable-ash-test',
      environment,
      execFile
    })
    expect(execFile).toHaveBeenCalledOnce()
    expect(execFile.mock.calls[0][0]).toBe('pnpm')
    expect(execFile.mock.calls[0][1]).toEqual(
      buildLinuxElectronBuilderArgs('x64', [], ['AppImage'])
    )
    expect(execFile.mock.calls[0][2]).toMatchObject({
      cwd: '/disposable-ash-test',
      env: { ASH_LINUX_PACKAGE_TARGETS: 'AppImage' },
      stdio: 'inherit'
    })
    expect(execFile.mock.calls[0][2].env).not.toHaveProperty('ORCA_LINUX_ARM64_RELEASE')
    expect(environment.ORCA_LINUX_ARM64_RELEASE).toBe('1')
  })

  it('keeps explicit arm64 selection and the release marker', () => {
    expect(
      resolveLinuxBuildArch({ platform: 'linux', hostArch: 'x64', requestedArch: 'arm64' })
    ).toBe('arm64')
    const execFile = vi.fn()
    runLocalLinuxBuild({
      arch: 'arm64',
      environment: { ASH_LINUX_PACKAGE_TARGETS: 'AppImage' },
      execFile
    })
    expect(execFile.mock.calls[0][1]).toContain('--arm64')
    expect(execFile.mock.calls[0][2].env.ORCA_LINUX_ARM64_RELEASE).toBe('1')
  })
})
