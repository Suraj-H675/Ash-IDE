import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import asar from '@electron/asar'
import { createAshPackageInputIdentityClaim } from './ash-package-input-identity.cjs'
import {
  parseSquashfsListing,
  parseSquashfsSuperblock
} from './ash-appimage-embedded-identity-squashfs.mjs'
import {
  parseDesktopIdentity,
  verifyEmbeddedIdentityFiles
} from './ash-appimage-embedded-identity-payload.mjs'
import {
  assertPathStillMatches,
  openPinnedRegularFile
} from './ash-appimage-embedded-identity-files.mjs'
import {
  assertReaderUnchanged,
  runReader,
  verifyReader
} from './ash-appimage-embedded-identity-reader.mjs'
import { verifyAshAppImageEmbeddedIdentity } from './verify-ash-appimage-embedded-identity-qa.mjs'

const APP_ID = 'com.ashide.desktop'
const DESKTOP_ENTRY = Buffer.from(
  '[Desktop Entry]\nName=Ash IDE\nType=Application\nStartupWMClass=com.ashide.desktop\nX-AppImage-Version=0.1.0\n'
)
const realFixture = process.env.ASH_M8_REAL_APPIMAGE_FIXTURE
const realFixtureSha256 = process.env.ASH_M8_REAL_APPIMAGE_SHA256
const realFixtureArchitecture = process.env.ASH_M8_REAL_APPIMAGE_ARCHITECTURE
const missingSidecarFixture = process.env.ASH_M8_MISSING_SIDECAR_FIXTURE
const missingSidecarSha256 = process.env.ASH_M8_MISSING_SIDECAR_SHA256
const readerPath = process.env.ASH_M8_UNSQUASHFS_READER
const hasRealFixtures =
  process.platform === 'linux' &&
  realFixture &&
  realFixtureSha256 &&
  realFixtureArchitecture &&
  missingSidecarFixture &&
  missingSidecarSha256 &&
  readerPath

let root
let resourcesDir
let sourceDir
let identityClaim
let identityFiles

function squashfsSuperblock(overrides = {}) {
  const bytes = Buffer.alloc(96)
  bytes.write('hsqs', 0, 'ascii')
  bytes.writeUInt32LE(8, 4)
  bytes.writeUInt32LE(131072, 12)
  bytes.writeUInt32LE(0, 16)
  bytes.writeUInt16LE(6, 20)
  bytes.writeUInt16LE(17, 22)
  bytes.writeUInt16LE(0x02d0, 24)
  bytes.writeUInt16LE(1, 26)
  bytes.writeUInt16LE(4, 28)
  bytes.writeUInt16LE(0, 30)
  bytes.writeBigUInt64LE(0x12345n, 32)
  bytes.writeBigUInt64LE(4096n, 40)
  bytes.writeBigUInt64LE(96n, 48)
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 56)
  bytes.writeBigUInt64LE(128n, 64)
  bytes.writeBigUInt64LE(256n, 72)
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 80)
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 88)
  for (const [offset, value] of Object.entries(overrides)) {
    const [field, at] = offset.split(':')
    if (field === 'u32') {
      bytes.writeUInt32LE(value, Number(at))
    }
    if (field === 'u64') {
      bytes.writeBigUInt64LE(BigInt(value), Number(at))
    }
  }
  return bytes
}

function listEntry(mode, size, path) {
  return `${mode} 0/0 ${String(size).padStart(12)} 2026-11-21 09:56 squashfs-root/${path}\n`
}

function validSquashfsListing(overrides = {}) {
  const entries = [
    'drwxr-xr-x 0/0 1 2026-11-21 09:56 squashfs-root\n',
    listEntry(overrides.resourcesMode ?? 'drwxr-xr-x', 32, 'resources'),
    listEntry('drwxr-xr-x', 32, 'resources/app.asar.unpacked'),
    listEntry('drwxr-xr-x', 32, 'resources/app.asar.unpacked/out'),
    listEntry(
      overrides.appAsarMode ?? '-rw-r--r--',
      overrides.appAsarSize ?? 10,
      'resources/app.asar'
    ),
    listEntry('-rw-r--r--', 32, 'resources/app.asar.unpacked/out/package.json'),
    listEntry('-rw-r--r--', 32, 'resources/ash-package-input-identity.json'),
    listEntry('-rw-r--r--', 64, 'com.ashide.desktop.desktop')
  ]
  return entries.join('')
}

function filesWithClaim(claim, files = identityFiles) {
  const updated = new Map(files)
  updated.set(
    'resources/ash-package-input-identity.json',
    Buffer.from(`${JSON.stringify(claim)}\n`)
  )
  return updated
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ash-appimage-identity-qa-test-'))
  resourcesDir = join(root, 'resources')
  sourceDir = join(root, 'asar-source')
  await mkdir(join(resourcesDir, 'app.asar.unpacked', 'out'), { recursive: true, mode: 0o700 })
  await mkdir(sourceDir, { mode: 0o700 })
  await mkdir(join(resourcesDir, 'app.asar.unpacked', 'out', 'cli'), {
    recursive: true,
    mode: 0o700
  })
  await mkdir(join(sourceDir, 'out'), { mode: 0o700 })
  await writeFile(
    join(sourceDir, 'package.json'),
    JSON.stringify({ name: 'ash-ide', version: '0.1.0' })
  )
  await writeFile(join(sourceDir, 'out', 'entry.js'), 'module.exports = true\n')
  await asar.createPackage(sourceDir, join(resourcesDir, 'app.asar'))
  await writeFile(
    join(resourcesDir, 'app.asar.unpacked', 'out', 'package.json'),
    JSON.stringify({
      name: 'ash-ide-compiled-output',
      type: 'commonjs',
      private: true,
      version: '0.1.0',
      commit: null
    })
  )
  identityClaim = await createAshPackageInputIdentityClaim({
    resourcesDir,
    appId: APP_ID,
    productName: 'Ash IDE',
    version: '0.1.0',
    architecture: 'x64',
    sourceCommit: null
  })
  identityFiles = new Map([
    ['resources/app.asar', await readFile(join(resourcesDir, 'app.asar'))],
    [
      'resources/app.asar.unpacked/out/package.json',
      await readFile(join(resourcesDir, 'app.asar.unpacked', 'out', 'package.json'))
    ],
    [
      'resources/ash-package-input-identity.json',
      await readFile(join(resourcesDir, 'ash-package-input-identity.json'))
    ],
    ['com.ashide.desktop.desktop', DESKTOP_ENTRY]
  ])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('pinned AppImage path', () => {
  it('rejects symlink, hardlink, and inode replacement aliases', async () => {
    const candidate = join(root, 'candidate.AppImage')
    const bytes = Buffer.from('caller-pinned image bytes')
    await writeFile(candidate, bytes)
    const pinned = await openPinnedRegularFile(candidate, 'AppImage', bytes.length)
    const previous = join(root, 'previous.AppImage')
    try {
      await rename(candidate, previous)
      await writeFile(candidate, bytes)
      await expect(assertPathStillMatches(candidate, pinned, 'AppImage')).rejects.toThrow(
        /changed while being inspected/
      )
    } finally {
      await pinned.handle.close()
    }

    const linked = join(root, 'hardlinked.AppImage')
    await link(previous, linked)
    await expect(openPinnedRegularFile(previous, 'AppImage', bytes.length)).rejects.toThrow(
      /single-link/
    )
    const symlinkPath = join(root, 'symlink.AppImage')
    await symlink(previous, symlinkPath)
    await expect(openPinnedRegularFile(symlinkPath, 'AppImage', bytes.length)).rejects.toThrow(
      /symlink aliases/
    )
  })
})

describe('SquashFS superblock bounds', () => {
  it('accepts one bounded v4.0 layout and rejects the ELF marker and corrupt table bounds', () => {
    expect(parseSquashfsSuperblock(squashfsSuperblock(), 944632, 944632 + 4096)).toMatchObject({
      offset: 944632,
      major: 4,
      minor: 0,
      inodeCount: 8,
      blockSize: 131072,
      compression: 'zstd',
      bytesUsed: 4096
    })
    expect(
      parseSquashfsSuperblock(squashfsSuperblock({ 'u32:4': 0x733d1974 }), 194183, 944632 + 4096)
    ).toBeNull()
    expect(
      parseSquashfsSuperblock(squashfsSuperblock({ 'u32:4': 50_001 }), 944632, 944632 + 4096)
    ).toBeNull()
    expect(parseSquashfsSuperblock(squashfsSuperblock({ 'u64:48': 4096n }), 0, 4096)).toBeNull()
    expect(parseSquashfsSuperblock(squashfsSuperblock(), 4001, 4096)).toBeNull()
  })
})

describe('bounded SquashFS listing', () => {
  it('accepts the exact regular files and their real directory ancestors', () => {
    const entries = parseSquashfsListing(Buffer.from(validSquashfsListing()), 8)
    expect(entries.get('resources/app.asar')).toMatchObject({ kind: '-', size: 10 })
    expect(entries.get('resources/app.asar.unpacked/out')).toMatchObject({ kind: 'd' })
  })

  it('rejects missing files, symlinked files, symlinked ancestors, traversal, and file bombs', () => {
    const valid = validSquashfsListing()
    expect(() =>
      parseSquashfsListing(
        Buffer.from(
          valid.replace(
            listEntry('-rw-r--r--', 32, 'resources/ash-package-input-identity.json'),
            ''
          )
        ),
        7
      )
    ).toThrow(/Required SquashFS file is absent/)
    expect(() =>
      parseSquashfsListing(
        Buffer.from(
          valid.replace(
            listEntry('-rw-r--r--', 10, 'resources/app.asar'),
            listEntry('lrwxrwxrwx', 10, 'resources/app.asar')
          )
        ),
        8
      )
    ).toThrow(/absent or not regular/)
    expect(() =>
      parseSquashfsListing(
        Buffer.from(
          valid.replace(
            listEntry('drwxr-xr-x', 32, 'resources'),
            `${'lrwxrwxrwx'} 0/0 32 2026-11-21 09:56 squashfs-root/resources -> /tmp\n`
          )
        ),
        8
      )
    ).toThrow(/Required SquashFS directory/)
    const traversal = `${valid}${listEntry('-rw-r--r--', 1, '../outside')}`
    expect(() => parseSquashfsListing(Buffer.from(traversal), 9)).toThrow(/unsafe path/)
    expect(() =>
      parseSquashfsListing(
        Buffer.from(validSquashfsListing({ appAsarSize: 64 * 1024 * 1024 + 1 })),
        8
      )
    ).toThrow(/size limit/)
    expect(() => parseSquashfsListing(Buffer.alloc(8 * 1024 * 1024 + 1), 8)).toThrow(/8 MiB/)
  })

  it('rejects duplicate entries and newline-injected paths', () => {
    const valid = validSquashfsListing()
    const appAsar = listEntry('-rw-r--r--', 10, 'resources/app.asar')
    expect(() => parseSquashfsListing(Buffer.from(`${valid}${appAsar}`), 9)).toThrow(
      /duplicate path/
    )
    const newlinePath = `${valid} -rw-r--r-- 0/0 1 2026-11-21 09:56 squashfs-root/odd\npath\n`
    expect(() => parseSquashfsListing(Buffer.from(newlinePath), 9)).toThrow()
  })
})

describe('embedded identity payload', () => {
  it('recomputes the package identity and validates the desktop entry', async () => {
    const result = await verifyEmbeddedIdentityFiles(identityFiles, 'x64')
    expect(result.claim).toEqual(identityClaim)
    expect(result.desktop).toEqual({
      name: 'Ash IDE',
      startupWmClass: 'com.ashide.desktop',
      version: '0.1.0'
    })
    expect(result.sidecarSha256).toBe(
      digest(identityFiles.get('resources/ash-package-input-identity.json'))
    )
    expect(result.appAsarSha256).toBe(identityClaim.capturedAppAsarSha256)
    expect(result.compiledCliPackageJsonSha256).toBe(
      identityClaim.capturedCompiledCliPackageJsonSha256
    )
    expect(result.desktopSha256).toBe(digest(identityFiles.get('com.ashide.desktop.desktop')))
  })

  it('rejects mismatched hashes, application IDs, architectures, and absent metadata', async () => {
    await expect(
      verifyEmbeddedIdentityFiles(
        filesWithClaim({ ...identityClaim, capturedAppAsarSha256: '0'.repeat(64) }),
        'x64'
      )
    ).rejects.toThrow(/does not match recomputed package inputs/)
    await expect(
      verifyEmbeddedIdentityFiles(
        filesWithClaim({ ...identityClaim, appId: 'com.other.app' }),
        'x64'
      )
    ).rejects.toThrow(/does not match recomputed package inputs/)
    await expect(
      verifyEmbeddedIdentityFiles(
        filesWithClaim({ ...identityClaim, architecture: 'arm64' }),
        'x64'
      )
    ).rejects.toThrow(/does not match recomputed package inputs/)
    const missingSidecar = new Map(identityFiles)
    missingSidecar.delete('resources/ash-package-input-identity.json')
    await expect(verifyEmbeddedIdentityFiles(missingSidecar, 'x64')).rejects.toThrow(
      /exact identity allowlist/
    )
  })

  it('rejects a desktop name or version that disagrees with the Ash package', async () => {
    const wrongName = new Map(identityFiles)
    wrongName.set(
      'com.ashide.desktop.desktop',
      Buffer.from(DESKTOP_ENTRY.toString().replace('Name=Ash IDE', 'Name=Orca'))
    )
    await expect(verifyEmbeddedIdentityFiles(wrongName, 'x64')).rejects.toThrow(
      /expected Ash IDE build/
    )
    expect(() =>
      parseDesktopIdentity(Buffer.from('[Desktop Entry]\nName=Ash IDE\nName=Orca\n'))
    ).toThrow(/duplicate key/)
    expect(() =>
      parseDesktopIdentity(
        Buffer.from(
          '[Desktop Entry]\nName=Ash IDE\nStartupWMClass=com.ashide.desktop\nX-AppImage-Version=0.1.0\n[Desktop Entry]\n'
        )
      )
    ).toThrow(/unexpected section/)
  })
})

describe.skipIf(!hasRealFixtures)('real AppImage embedded identity QA', () => {
  it('executes the opened verified reader inode even when its pathname is replaced', async () => {
    const localReader = join(root, 'private-unsquashfs')
    await copyFile(readerPath, localReader)
    await chmod(localReader, 0o700)
    const pinned = await verifyReader(localReader)
    try {
      await rename(localReader, join(root, 'old-reader-inode'))
      await writeFile(localReader, Buffer.from('not an executable'), { mode: 0o700 })
      const output = runReader(
        pinned,
        ['-offset', '944632', '-mem', '32M', '-processors', '1', '-stat', realFixture],
        64 * 1024,
        root
      )
      expect(output.toString('utf8')).toMatch(/^Found a valid SQUASHFS 4:0 superblock/)
      await expect(assertReaderUnchanged(pinned)).rejects.toThrow(/changed while being inspected/)
    } finally {
      await pinned.handle.close()
    }
  })

  it('matches actual embedded bytes while keeping candidate identity unverified', async () => {
    const result = await verifyAshAppImageEmbeddedIdentity({
      artifactPath: realFixture,
      expectedSha256: realFixtureSha256,
      architecture: realFixtureArchitecture,
      readerPath
    })
    expect(result).toMatchObject({
      checkpoint: { id: 'PK-05', outcome: 'matched' },
      squashfs: { offset: 944632, version: '4.0' },
      embeddedIdentity: {
        appId: APP_ID,
        productName: 'Ash IDE',
        packageName: 'ash-ide',
        version: '0.1.0',
        architecture: realFixtureArchitecture,
        appAsarSha256: result.embeddedIdentity.capturedAppAsarSha256,
        compiledCliPackageJsonSha256: result.embeddedIdentity.capturedCompiledCliPackageJsonSha256
      },
      candidateIdentity: { state: 'unverified' },
      ashPackageIdentityVerified: false,
      activationAvailable: false
    })
    const file = await open(realFixture, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const fakeMarker = Buffer.alloc(96)
      await file.read(fakeMarker, 0, fakeMarker.length, 194183)
      expect(parseSquashfsSuperblock(fakeMarker, 194183, (await file.stat()).size)).toBeNull()
    } finally {
      await file.close()
    }
  })

  it('fails closed when the real artifact has no identity sidecar', async () => {
    await expect(
      verifyAshAppImageEmbeddedIdentity({
        artifactPath: missingSidecarFixture,
        expectedSha256: missingSidecarSha256,
        architecture: realFixtureArchitecture,
        readerPath
      })
    ).rejects.toThrow(/identity\.json/)
  })

  it('rejects a symlink, mismatched outer hash, wrong architecture, and corrupt SquashFS', async () => {
    await expect(
      verifyAshAppImageEmbeddedIdentity({
        artifactPath: realFixture,
        expectedSha256: '0'.repeat(64),
        architecture: realFixtureArchitecture,
        readerPath
      })
    ).rejects.toThrow(/outer SHA-256/)
    await expect(
      verifyAshAppImageEmbeddedIdentity({
        artifactPath: realFixture,
        expectedSha256: realFixtureSha256,
        architecture: realFixtureArchitecture === 'x64' ? 'arm64' : 'x64',
        readerPath
      })
    ).rejects.toThrow(/ELF header/)

    const alias = join(root, 'image-link.AppImage')
    await symlink(realFixture, alias)
    await expect(
      verifyAshAppImageEmbeddedIdentity({
        artifactPath: alias,
        expectedSha256: realFixtureSha256,
        architecture: realFixtureArchitecture,
        readerPath
      })
    ).rejects.toThrow(/symlink aliases/)

    const corruptBytes = Buffer.alloc(194183 + 96)
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(corruptBytes)
    corruptBytes.writeUInt16LE(realFixtureArchitecture === 'arm64' ? 183 : 62, 18)
    Buffer.from('hsqs').copy(corruptBytes, 194183)
    const corruptPath = join(root, 'corrupt.AppImage')
    await writeFile(corruptPath, corruptBytes, { mode: 0o600 })
    await expect(
      verifyAshAppImageEmbeddedIdentity({
        artifactPath: corruptPath,
        expectedSha256: digest(corruptBytes),
        architecture: realFixtureArchitecture,
        readerPath: '/not-used-before-superblock-validation'
      })
    ).rejects.toThrow(/no structurally valid SquashFS/)
  })
})
