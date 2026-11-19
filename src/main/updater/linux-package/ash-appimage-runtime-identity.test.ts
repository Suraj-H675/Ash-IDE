import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAppImageRuntimeIdentity } from './appimage-runtime-identity'

describe.skipIf(process.platform !== 'linux')('running Ash AppImage identity', () => {
  let root: string
  let appImagePath: string
  let appDir: string
  let execPath: string
  let resourcesPath: string
  let marker: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ash-appimage-identity-'))
    appImagePath = join(root, 'ash-ide-linux.AppImage')
    appDir = join(root, 'mount')
    execPath = join(appDir, 'ash-ide')
    resourcesPath = join(appDir, 'resources')
    marker = join(resourcesPath, 'app.asar.unpacked', 'out', 'package.json')
    mkdirSync(join(resourcesPath, 'app.asar.unpacked', 'out'), { recursive: true })
    writeFileSync(appImagePath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0x41, 0x49, 2]), {
      mode: 0o700
    })
    writeFileSync(execPath, 'synthetic executable', { mode: 0o700 })
    symlinkSync('ash-ide', join(appDir, 'AppRun'))
    writeFileSync(join(resourcesPath, 'package-type'), 'AppImage')
    writeFileSync(marker, JSON.stringify({ name: 'ash-ide-compiled-output', type: 'commonjs' }))
  })

  afterEach(() => rmSync(root, { force: true, recursive: true }))

  function resolveIdentity() {
    return resolveAppImageRuntimeIdentity({
      platform: 'linux',
      environment: { APPIMAGE: appImagePath, APPDIR: appDir },
      execPath,
      resourcesPath
    })
  }

  it('accepts the current compiled Ash marker and keeps compatibility for an absent type marker', () => {
    expect(resolveIdentity()).toEqual({ appImagePath })
    rmSync(join(resourcesPath, 'package-type'))
    expect(resolveIdentity()).toEqual({ appImagePath })
  })

  it('rejects an Orca marker even with AppImage packaging evidence', () => {
    writeFileSync(marker, JSON.stringify({ name: 'orca-compiled-output', type: 'commonjs' }))
    expect(resolveIdentity()).toBeNull()
  })

  it('rejects a distro package, wrong executable or escaping marker alias', () => {
    const type = join(resourcesPath, 'package-type')
    writeFileSync(type, 'deb')
    expect(resolveIdentity()).toBeNull()
    writeFileSync(type, 'AppImage')
    const ashExecutable = execPath
    execPath = join(appDir, 'orca')
    writeFileSync(execPath, 'synthetic executable', { mode: 0o700 })
    expect(resolveIdentity()).toBeNull()
    execPath = ashExecutable
    rmSync(marker)
    const foreignMarker = join(root, 'outside.json')
    writeFileSync(
      foreignMarker,
      JSON.stringify({ name: 'ash-ide-compiled-output', type: 'commonjs' })
    )
    symlinkSync(foreignMarker, marker)
    expect(resolveIdentity()).toBeNull()
  })
})
