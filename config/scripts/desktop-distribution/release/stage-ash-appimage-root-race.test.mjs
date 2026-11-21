import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stageAshAppImage } from './stage-ash-appimage.mjs'

// Replace the caller-visible directory after staging has opened and validated
// it, but before its first child is created. Do not race a real user directory.
const race = vi.hoisted(() => ({ beforeStageMkdir: null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    mkdtemp: async (...args) => {
      if (String(args[0]).includes('/.ash-release-') && race.beforeStageMkdir) {
        const inject = race.beforeStageMkdir
        race.beforeStageMkdir = null
        await inject()
      }
      return actual.mkdtemp(...args)
    }
  }
})

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const assetName = 'ash-ide-linux.AppImage'
let fixtureRoot

afterEach(async () => {
  race.beforeStageMkdir = null
  if (fixtureRoot) {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
  fixtureRoot = undefined
})

describe.skipIf(process.platform !== 'linux')('offline stage root inode confinement', () => {
  it('fails closed without writing into a substituted stage root', async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'ash-stage-root-race-'))
    const stageRoot = join(fixtureRoot, 'stage')
    const movedRoot = join(fixtureRoot, 'moved-stage')
    const decoyRoot = join(fixtureRoot, 'decoy')
    const artifactPath = join(fixtureRoot, assetName)
    await mkdir(stageRoot, { mode: 0o700 })
    await mkdir(decoyRoot, { mode: 0o700 })
    const marker = Buffer.from('existing unrelated file must not be overwritten')
    await writeFile(join(decoyRoot, assetName), marker)

    const artifact = Buffer.alloc(32)
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(artifact)
    artifact.writeUInt16LE(62, 18)
    await writeFile(artifactPath, artifact)
    const manifest = {
      schema: 1,
      product: 'com.ashide.desktop',
      repository: 'Suraj-H675/Ash-IDE',
      platform: 'linux',
      architecture: 'x64',
      format: 'AppImage',
      version: '0.2.0',
      tag: 'v0.2.0',
      asset: assetName,
      size: artifact.length,
      sha256: createHash('sha256').update(artifact).digest('hex'),
      issuedAtMs: Date.now() - 1_000,
      expiresAtMs: Date.now() + 60_000
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    race.beforeStageMkdir = async () => {
      await rename(stageRoot, movedRoot)
      await symlink(decoyRoot, stageRoot)
    }

    await expect(
      stageAshAppImage({
        manifestBytes,
        signature: sign(null, manifestBytes, privateKey),
        policy: { publicKey, architecture: 'x64', installedVersion: '0.1.0' },
        artifactPath,
        stageRoot
      })
    ).rejects.toThrow(/staging directory changed during publishing/)

    expect(race.beforeStageMkdir).toBeNull()
    expect(await readdir(movedRoot)).toEqual([])
    expect(await readdir(decoyRoot)).toEqual([assetName])
    expect(await readFile(join(decoyRoot, assetName))).toEqual(marker)
    expect(await readFile(artifactPath)).toEqual(artifact)
  })
})
