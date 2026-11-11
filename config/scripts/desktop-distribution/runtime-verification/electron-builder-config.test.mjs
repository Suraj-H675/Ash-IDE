import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '../../..', '..')

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../../../electron-builder.config.cjs')
const { copyFiles, FileMatcher } = require('app-builder-lib/out/fileMatcher')

describe('electron-builder config', () => {
  it.each(['file', 'directory'])('keeps a root notes %s out of app.asar', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-packaging-notes-'))
    const source = join(root, 'app')
    const destination = join(root, 'selected')
    const runtimePaths = [
      'package.json',
      'out/main/index.js',
      'out/renderer/index.html',
      'out/cli/index.js',
      'out/shared/index.js',
      'out/main/notes/index.js',
      'out/renderer/assets/notes/help.md',
      'resources/notes/help.md',
      'notes.txt'
    ]
    const notesPaths =
      kind === 'file'
        ? ['notes']
        : [
            'notes/build.log',
            'notes/installed-orca-backup/Orca.exe',
            'notes/installed-orca-backup/resources/app.asar',
            'notes/orca-windows-setup.exe',
            'notes/.recovery/state.json'
          ]
    try {
      for (const fixturePath of [...runtimePaths, ...notesPaths]) {
        const file = join(source, fixturePath)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, 'synthetic fixture\n')
      }
      if (kind === 'directory') {
        await mkdir(join(source, 'notes', 'empty'))
      }
      const matcher = new FileMatcher(
        source,
        destination,
        (value) => value,
        electronBuilderConfig.files
      )
      // copyFiles adds the default include and prunes excluded directories during traversal.
      await copyFiles([matcher])
      for (const runtimePath of runtimePaths) {
        expect(await readFile(join(destination, runtimePath), 'utf8')).toBe('synthetic fixture\n')
      }
      const isPacked = matcher.createFilter()
      for (const notesPath of new Set(['notes', ...notesPaths])) {
        const file = join(source, notesPath)
        expect(isPacked(file, await lstat(file)), notesPath).toBe(false)
      }
      expect(existsSync(join(destination, 'notes'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // All-negation lists implicitly include **/*; missing examples exclusion shipped hostile-panel in 1.4.160-rc.3. Exercise real matcher, not pattern spelling.

  // CI never creates ~270MB/branch out/electron-dev caches; only local packages exposed this bloat.

  // Ash excludes the remote SSH relay; no relay resource should be shipped.

  // Bundled agent-browser answered "No skills found" because only its binary shipped (#17705).
  const hostBuilderPlatform = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform]
  it.runIf(hostBuilderPlatform)(
    'ships the agent-browser skill catalog the packaged binary resolves',
    async () => {
      const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-agent-browser-'))
      try {
        const resources = electronBuilderConfig[hostBuilderPlatform].extraResources.filter(
          (entry) => entry.from.startsWith('node_modules/agent-browser/') || entry.to === 'skills'
        )
        const expand = (value) => value.replace('${arch}', process.arch)
        await copyFiles(
          resources.map(
            (entry) =>
              new FileMatcher(
                join(REPO_ROOT, expand(entry.from)),
                join(resourcesDir, expand(entry.to)),
                (value) => value
              )
          )
        )
        const binary = resources.find((entry) => entry.to.startsWith('agent-browser-'))
        expect(binary).toBeDefined()
        const binaryPath = join(resourcesDir, expand(binary.to))
        // afterPack restores the executable bit; upstream tarball modes vary.
        await chmod(binaryPath, 0o755)
        const { AGENT_BROWSER_SKILLS_DIR: _override, ...env } = process.env
        const { stdout } = await promisify(execFile)(binaryPath, ['skills', 'get', 'core'], {
          env,
          windowsHide: true
        })
        expect(stdout).toContain('name: core')
      } finally {
        await rm(resourcesDir, { recursive: true, force: true })
      }
    }
  )

  it('packages only the local desktop surface, not retired mobile, SSH or voice resources', () => {
    const targets = ['linux', 'mac', 'win']
    for (const platform of targets) {
      const resources = electronBuilderConfig[platform].extraResources
      expect(resources).toEqual(expect.arrayContaining([expect.objectContaining({ to: 'skills' })]))
      for (const resource of resources) {
        expect(resource.from).not.toMatch(/out\/relay|out\/orcad-template|sherpa-onnx/)
        expect(resource.to).not.toMatch(/^relay$|^orcad-template|sherpa-onnx/)
      }
    }
    expect(electronBuilderConfig.files).toContain('!out/mobile-web{,/**/*}')
    expect(electronBuilderConfig.asarUnpack).not.toContain('out/mobile-web/**')
    const beforePack = electronBuilderConfig.beforePack.toString()
    expect(beforePack).toContain('assertNotDarkBuild')
    expect(beforePack).not.toMatch(/assertMobileWebBundleBuilt|assertOrcadTemplateBuilt/)
    const afterPack = electronBuilderConfig.afterPack.toString()
    expect(afterPack).not.toMatch(/assertPackagedWebClient|assertPackagedServeSelectionEntry/)
    expect(afterPack).toContain('verifyPackagedMainRuntimeDeps')
    expect(afterPack).toContain('verifyPackagedDaemonEntryBoots')
  })

  it('runs native desktop and package builds without excluded payloads or altering installed CLI', async () => {
    const { scripts } = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'))
    for (const name of [
      'build:desktop:assets',
      'build:release',
      'build:release:javascript',
      'build:release:javascript:parallel',
      'build:release:host',
      'build:release:parallel'
    ]) {
      expect(scripts[name], name).not.toMatch(/build:(?:mobile-web|wsl-guest|web-from-renderer)/)
    }
    expect(scripts['build:desktop:assets']).toContain('build:cli:assets')
    expect(scripts['build:cli:assets']).not.toContain('prepare:cli-output')
    expect(scripts['build:linux']).toContain('build:native')
    expect(scripts['build:linux']).toContain('ensure:electron-runtime')
  })

  it('validates each AppImage before electron-builder publishes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-electron-builder-appimage-'))
    try {
      const appImage = join(root, 'ash-ide-linux.AppImage')
      await writeFile(appImage, 'not an ELF')
      await chmod(appImage, 0o755)

      expect(() =>
        electronBuilderConfig.artifactBuildCompleted({ file: appImage, arch: 1 })
      ).toThrow(/ELF header is outside/)
      expect(() =>
        electronBuilderConfig.artifactBuildCompleted({ file: appImage, arch: 3 })
      ).toThrow(/filename targets x64, but electron-builder target is arm64/)
      const arm64AppImage = join(root, 'ash-ide-linux-arm64.AppImage')
      await writeFile(arm64AppImage, 'not an ELF')
      await chmod(arm64AppImage, 0o755)
      expect(() =>
        electronBuilderConfig.artifactBuildCompleted({ file: arm64AppImage, arch: 3 })
      ).toThrow(/ELF header is outside/)
      const oldOrca = join(root, 'orca-linux.AppImage')
      await writeFile(oldOrca, 'not an ELF')
      expect(() =>
        electronBuilderConfig.artifactBuildCompleted({ file: oldOrca, arch: 1 })
      ).toThrow(/unsupported artifact name/)
      expect(() =>
        electronBuilderConfig.artifactBuildCompleted({ file: join(root, 'ash-ide.deb') })
      ).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('arch-aware packaging guard', () => {
  // electron-builder Arch enum: ia32=0, x64=1, armv7l=2, arm64=3.
  const HOST_ARCH = process.arch === 'arm64' ? 3 : 1

  const packHost = (arch) =>
    electronBuilderConfig.beforePack(
      { electronPlatformName: process.platform, arch },
      () => undefined
    )

  it('refuses to package a dark layout-owner build', () => {
    const previous = process.env.ORCA_LAYOUT_OWNER
    process.env.ORCA_LAYOUT_OWNER = 'main'
    try {
      expect(() => packHost(HOST_ARCH)).toThrow('ORCA_LAYOUT_OWNER=main')
    } finally {
      if (previous === undefined) {
        delete process.env.ORCA_LAYOUT_OWNER
      } else {
        process.env.ORCA_LAYOUT_OWNER = previous
      }
    }
  })

  // The host's own build is the foreign-arch case: a Windows checkout compiles these for its CPU only.
})
