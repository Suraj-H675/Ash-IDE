import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import asar from '@electron/asar'
import { createAshPackageInputIdentityClaim } from './ash-package-input-identity.cjs'
import { verifyPackageCliBin } from '../../cli-build/verify-cli-bin.mjs'

let root
let resources
let sourceDir
let cliPackagePath

function cliMetadata(overrides = {}) {
  return {
    name: 'ash-ide-compiled-output',
    type: 'commonjs',
    private: true,
    version: '0.2.0',
    commit: 'a'.repeat(40),
    ...overrides
  }
}

async function makeArchive({ name = 'ash-ide', version = '0.2.0' } = {}) {
  await rm(sourceDir, { recursive: true, force: true })
  await rm(join(resources, 'app.asar'), { force: true })
  await mkdir(join(sourceDir, 'out'), { recursive: true })
  await writeFile(join(sourceDir, 'package.json'), JSON.stringify({ name, version }))
  await writeFile(join(sourceDir, 'out', 'entry.js'), 'module.exports = true\n')
  await asar.createPackage(sourceDir, join(resources, 'app.asar'))
}

async function attest(overrides = {}) {
  return createAshPackageInputIdentityClaim({
    resourcesDir: resources,
    appId: 'com.ashide.desktop',
    productName: 'Ash IDE',
    version: '0.2.0',
    architecture: 'x64',
    sourceCommit: 'a'.repeat(40),
    ...overrides
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ash-package-input-identity-test-'))
  resources = join(root, 'resources')
  sourceDir = join(root, 'asar-source')
  cliPackagePath = join(resources, 'app.asar.unpacked', 'out', 'package.json')
  await mkdir(join(resources, 'app.asar.unpacked', 'out'), { recursive: true, mode: 0o700 })
  await makeArchive()
  const cliProjectDir = join(resources, 'app.asar.unpacked')
  await mkdir(join(cliProjectDir, 'out', 'cli'), { recursive: true })
  await writeFile(
    join(cliProjectDir, 'package.json'),
    JSON.stringify({ name: 'ash-ide', version: '0.2.0', bin: { 'ash-ide': 'out/cli/index.js' } })
  )
  await writeFile(join(cliProjectDir, 'out', 'cli', 'index.js'), '#!/usr/bin/env node\n')
  verifyPackageCliBin({
    projectDir: cliProjectDir,
    sourceCommit: 'a'.repeat(40),
    fixPackageJson: true,
    fixExecutable: true
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Ash package input identity claim', () => {
  it('attests bounded package metadata and hashes the exact app.asar and compiled CLI metadata', async () => {
    const archive = await readFile(join(resources, 'app.asar'))
    const cliPackage = await readFile(cliPackagePath)
    const result = await attest()

    expect(result).toEqual({
      schema: 1,
      appId: 'com.ashide.desktop',
      productName: 'Ash IDE',
      packageName: 'ash-ide',
      version: '0.2.0',
      architecture: 'x64',
      sourceCommit: 'a'.repeat(40),
      evidenceKind: 'packaging-input-snapshot',
      capturedAppAsarSha256: createHash('sha256').update(archive).digest('hex'),
      capturedCompiledCliPackageJsonSha256: createHash('sha256').update(cliPackage).digest('hex')
    })
    expect(
      JSON.parse(await readFile(join(resources, 'ash-package-input-identity.json'), 'utf8'))
    ).toEqual(result)
  })

  it('rejects mismatched embedded application or compiled CLI product and version', async () => {
    await makeArchive({ name: 'orca', version: '0.2.0' })
    await expect(attest()).rejects.toThrow(/expected Ash IDE package version/)

    await makeArchive({ name: 'ash-ide', version: '0.3.0' })
    await expect(attest()).rejects.toThrow(/expected Ash IDE package version/)

    await makeArchive()
    await writeFile(cliPackagePath, JSON.stringify(cliMetadata({ version: '0.3.0' })))
    await expect(attest()).rejects.toThrow(/expected Ash IDE package version/)

    await writeFile(cliPackagePath, JSON.stringify(cliMetadata({ name: 'ash-ide' })))
    await expect(attest()).rejects.toThrow(/expected Ash IDE package version/)

    for (const invalid of [{ type: 'module' }, { private: false }]) {
      await writeFile(cliPackagePath, JSON.stringify(cliMetadata(invalid)))
      await expect(attest()).rejects.toThrow(/private CommonJS output/)
    }
  })

  it('rejects duplicate JSON keys, malformed input, symlinked metadata, and hard links', async () => {
    await writeFile(cliPackagePath, '{"name":"ash-ide","name":"orca","version":"0.2.0"}')
    await expect(attest()).rejects.toThrow(/duplicate JSON keys/)

    await writeFile(cliPackagePath, '{broken')
    await expect(attest()).rejects.toThrow(SyntaxError)

    const external = join(root, 'external-package.json')
    await writeFile(external, JSON.stringify(cliMetadata()))
    await rm(cliPackagePath)
    await symlink(external, cliPackagePath)
    await expect(attest()).rejects.toThrow()

    await rm(cliPackagePath)
    await link(external, cliPackagePath)
    await expect(attest()).rejects.toThrow(/single-link/)
  })

  it('rejects ambiguous or traversing ASAR metadata paths before extraction', async () => {
    for (const entries of [
      ['/package.json', 'package.json'],
      ['/../package.json'],
      ['/package.json', '//package.json']
    ]) {
      await expect(
        attest({
          asar: {
            listPackage: () => entries,
            statFile: () => {
              throw new Error('metadata path should have been rejected')
            },
            extractFile: () => {
              throw new Error('metadata path should have been rejected')
            }
          }
        })
      ).rejects.toThrow(/ambiguous|traversing|duplicate/)
    }
  })

  it('bounds the ASAR header before the archive parser materializes its entry list', async () => {
    const oversizedPrefix = Buffer.alloc(8)
    oversizedPrefix.writeUInt32LE(4, 0)
    oversizedPrefix.writeUInt32LE(16 * 1024 * 1024 + 4, 4)
    const archive = await readFile(join(resources, 'app.asar'))
    oversizedPrefix.copy(archive)
    await writeFile(join(resources, 'app.asar'), archive)

    let parserCalled = false
    const asarSpy = {
      listPackage: () => {
        parserCalled = true
        return asar.listPackage(join(resources, 'app.asar'))
      },
      statFile: asar.statFile,
      extractFile: asar.extractFile
    }
    await expect(attest({ asar: asarSpy })).rejects.toThrow(/header.*inspection limit/)
    expect(parserCalled).toBe(false)

    await makeArchive()
    const malformedPrefix = Buffer.alloc(8)
    malformedPrefix.writeUInt32LE(8, 0)
    malformedPrefix.writeUInt32LE(12, 4)
    const malformedArchive = await readFile(join(resources, 'app.asar'))
    malformedPrefix.copy(malformedArchive)
    await writeFile(join(resources, 'app.asar'), malformedArchive)
    await expect(attest()).rejects.toThrow(/header.*malformed/)
  })

  it('rejects a linked ASAR package entry and unsupported build identity', async () => {
    const linkedAsar = {
      listPackage: () => ['/package.json'],
      statFile: () => ({ link: '../package.json', size: 40, offset: '0' }),
      extractFile: () => Buffer.from('{"name":"ash-ide","version":"0.2.0"}')
    }
    await expect(attest({ asar: linkedAsar })).rejects.toThrow(/regular archive entry/)
    await expect(attest({ appId: 'com.stably.os' })).rejects.toThrow(/release contract/)
    await expect(attest({ architecture: 'universal' })).rejects.toThrow(/release contract/)
  })

  it('rejects an actual ASAR package.json symlink without following it', async () => {
    const target = join(sourceDir, 'real-package.json')
    await writeFile(target, JSON.stringify({ name: 'ash-ide', version: '0.2.0' }))
    await rm(join(sourceDir, 'package.json'))
    await symlink('real-package.json', join(sourceDir, 'package.json'))
    await rm(join(resources, 'app.asar'))
    await asar.createPackage(sourceDir, join(resources, 'app.asar'))

    await expect(attest()).rejects.toThrow(/regular archive entry/)
  })

  it('rejects if the packaged ASAR source changes during inspection', async () => {
    let changed = false
    const guardedAsar = {
      listPackage: (archivePath) => {
        changed = true
        return asar.listPackage(archivePath)
      },
      statFile: (archivePath, entry) => {
        writeFileSync(join(resources, 'app.asar'), 'changed after the pinned copy')
        return asar.statFile(archivePath, entry)
      },
      extractFile: (archivePath, entry) => asar.extractFile(archivePath, entry)
    }

    await expect(attest({ asar: guardedAsar })).rejects.toThrow(/changed while being inspected/)

    expect(changed).toBe(true)
    expect(await readFile(join(resources, 'app.asar'), 'utf8')).toBe(
      'changed after the pinned copy'
    )
    await expect(
      readFile(join(resources, 'ash-package-input-identity.json'))
    ).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('rejects ASAR and CLI metadata changes immediately before sidecar publication', async () => {
    const mutations = [
      {
        path: () => join(resources, 'app.asar'),
        value: 'changed after package inspection'
      },
      {
        path: () => cliPackagePath,
        value: `${JSON.stringify(cliMetadata())}\n`
      }
    ]

    for (const mutation of mutations) {
      await makeArchive()
      await writeFile(cliPackagePath, JSON.stringify(cliMetadata()))
      await expect(
        attest({
          beforeSidecarPublish: () => writeFileSync(mutation.path(), mutation.value)
        })
      ).rejects.toThrow(/changed while being inspected/)
      await expect(
        readFile(join(resources, 'ash-package-input-identity.json'))
      ).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
  })
})
