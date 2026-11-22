// Manual QA only: snapshot the pinned AppImage, then use *its* embedded
// CLI, profile-state code and Node runtime. No adjacent build files are used.
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertPrivateDirectory,
  assertPathStillMatches,
  copyPinnedAppImage,
  hashOpenedPinnedFile,
  openPinnedRegularFile
} from '../release/ash-appimage-embedded-identity-files.mjs'
import {
  PINNED_APPIMAGE_FD_PATH,
  assertReaderUnchanged,
  runReader,
  verifyReader
} from '../release/ash-appimage-embedded-identity-reader.mjs'
import { verifyAshAppImageEmbeddedIdentity } from '../release/verify-ash-appimage-embedded-identity-qa.mjs'
import { parseSquashfsListing } from '../release/ash-appimage-embedded-identity-squashfs.mjs'

const VALID_IMAGE_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/
const EXECUTED_IMAGE_TREES = Object.freeze([
  'resources/node-runtime',
  'resources/node_modules',
  'resources/app.asar.unpacked/out'
])

/** No link or device in any tree that will be executed or require()-loaded. */
export function assertSelectedImageTree(entries) {
  for (const path of EXECUTED_IMAGE_TREES) {
    if (entries.get(path)?.kind !== 'd') {
      throw new Error(`Embedded executable tree is not a real directory: ${path}`)
    }
  }
  if (entries.get('resources/ash-package-input-identity.json')?.kind !== '-') {
    throw new Error('Embedded package identity is not a real file')
  }
  for (const [path, entry] of entries) {
    if (
      EXECUTED_IMAGE_TREES.some((root) => path === root || path.startsWith(`${root}/`)) &&
      entry.kind !== 'd' &&
      entry.kind !== '-'
    ) {
      throw new Error(`Embedded executable tree contains a symlink or unsafe entry: ${path}`)
    }
  }
}

async function assertExtractedTreeHasNoLinks(root) {
  const pending = [root]
  let count = 0
  while (pending.length > 0) {
    const dir = pending.pop()
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      count++
      if (count > 50_000) {
        throw new Error('Embedded execution tree exceeds the file count budget')
      }
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
      } else if (!entry.isFile()) {
        throw new Error('Embedded execution tree extracted a symlink or unsafe filesystem object')
      }
    }
  }
}

export async function extractEmbeddedFixture({
  artifact,
  sha256,
  version,
  readerPath,
  root,
  label
}) {
  assert.ok(['previous', 'candidate'].includes(label))
  assert.match(sha256, /^[a-f0-9]{64}$/)
  assert.match(version, VALID_IMAGE_VERSION)
  assert.equal(resolve(root), root)
  assert.match(root, /^\/var\/tmp\/ashcross\.[A-Za-z0-9]{6}$/)
  await assertPrivateDirectory(root, 'Native cross-version QA directory')

  // This diagnostic confirms source bytes and embedded package metadata,
  // not an Ash release signature. Production activation remains unavailable.
  const diagnostic = await verifyAshAppImageEmbeddedIdentity({
    artifactPath: artifact,
    expectedSha256: sha256,
    architecture: 'x64',
    readerPath
  })
  assert.equal(diagnostic.checkpoint.outcome, 'matched')
  assert.equal(diagnostic.outerArtifact.sha256, sha256)
  assert.equal(diagnostic.embeddedIdentity.version, version)
  assert.equal(diagnostic.embeddedIdentity.appId, 'com.ashide.desktop')
  assert.equal(diagnostic.ashPackageIdentityVerified, false)
  assert.equal(diagnostic.activationAvailable, false)

  const imagePath = join(root, `${label}.AppImage`)
  const input = await copyPinnedAppImage(artifact, sha256, imagePath)
  await input.handle.close()
  await chmod(imagePath, 0o700)
  const pinned = await openPinnedRegularFile(imagePath, 'Private QA AppImage', 512 * 1024 * 1024, {
    privateFile: true
  })
  const reader = await verifyReader(readerPath)
  const output = join(root, `${label}-embedded`)
  try {
    await mkdir(output, { mode: 0o700 })
    await assertPrivateDirectory(output, 'Private QA embedded resources')
    const offset = diagnostic.squashfs.offset
    const listing = runReader(
      reader,
      [
        '-offset',
        String(offset),
        '-mem',
        '32M',
        '-processors',
        '1',
        '-lln',
        PINNED_APPIMAGE_FD_PATH
      ],
      8 * 1024 * 1024,
      root,
      pinned
    )
    assertSelectedImageTree(parseSquashfsListing(listing, diagnostic.squashfs.inodeCount))
    runReader(
      reader,
      [
        '-offset',
        String(offset),
        '-mem',
        '32M',
        '-processors',
        '1',
        '-no-progress',
        '-no-xattrs',
        '-d',
        output,
        PINNED_APPIMAGE_FD_PATH,
        'resources/node-runtime',
        'resources/node_modules',
        'resources/app.asar.unpacked/out',
        'resources/ash-package-input-identity.json'
      ],
      8 * 1024 * 1024,
      root,
      pinned
    )
    await assertExtractedTreeHasNoLinks(output)
    const resources = join(output, 'resources')
    const embeddedPackage = await readFile(join(resources, 'app.asar.unpacked/out/package.json'))
    const packageSha = createHash('sha256').update(embeddedPackage).digest('hex')
    assert.equal(packageSha, diagnostic.embeddedIdentity.compiledCliPackageJsonSha256)
    const claim = JSON.parse(
      await readFile(join(resources, 'ash-package-input-identity.json'), 'utf8')
    )
    assert.equal(claim.version, version)
    assert.equal(claim.appId, 'com.ashide.desktop')
    assert.equal(claim.capturedCompiledCliPackageJsonSha256, packageSha)
    assert.equal(JSON.parse(embeddedPackage.toString()).version, version)
    await assertReaderUnchanged(reader)
    assert.equal(await hashOpenedPinnedFile(pinned, 'Private QA AppImage'), sha256)
    await assertPathStillMatches(imagePath, pinned, 'Private QA AppImage')
    process.stdout.write(
      `${JSON.stringify({
        status: 'matched-offline-QA-only',
        label,
        version,
        embeddedRuntime: true,
        productionActivationAvailable: false
      })}\n`
    )
  } finally {
    await reader.handle.close()
    await pinned.handle.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 8) {
      throw new Error(
        'Usage: embedded-fixture.mjs APPIMAGE SHA256 VERSION READER ROOT previous|candidate'
      )
    }
    const [artifact, sha256, version, readerPath, root, label] = process.argv.slice(2)
    await extractEmbeddedFixture({ artifact, sha256, version, readerPath, root, label })
  } catch (error) {
    console.error(`[native-embedded-qa] ${error.message}`)
    process.exitCode = 1
  }
}
