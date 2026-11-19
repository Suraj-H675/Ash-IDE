import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stageAshAppImage } from './stage-ash-appimage.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const foreignKey = generateKeyPairSync('ed25519').privateKey
const basename = 'ash-ide-linux.AppImage'

let root
let stageRoot
let artifactPath
let artifact
let manifest

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ash-release-admission-'))
  stageRoot = join(root, 'stage')
  artifactPath = join(root, basename)
  await mkdir(stageRoot, { mode: 0o700 })
  artifact = Buffer.alloc(32, 0)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(artifact)
  artifact.writeUInt16LE(62, 18)
  await writeFile(artifactPath, artifact)
  manifest = {
    schema: 1,
    product: 'com.ashide.desktop',
    repository: 'Suraj-H675/Ash-IDE',
    platform: 'linux',
    architecture: 'x64',
    format: 'AppImage',
    version: '0.2.0',
    tag: 'v0.2.0',
    asset: basename,
    size: artifact.length,
    sha256: createHash('sha256').update(artifact).digest('hex'),
    issuedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 60_000
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function stage(fixture = manifest, overrides = {}, key = privateKey) {
  const manifestBytes = Buffer.from(JSON.stringify(fixture))
  return stageAshAppImage({
    manifestBytes,
    signature: sign(null, manifestBytes, key),
    policy: { publicKey, architecture: 'x64', installedVersion: '0.1.0' },
    artifactPath,
    stageRoot,
    ...overrides
  })
}

describe.skipIf(process.platform !== 'linux')('offline Ash AppImage admission', () => {
  it('publishes the exact verified bytes privately without executing or altering the input', async () => {
    const staged = await stage()
    expect(staged).toMatchObject({ version: '0.2.0', sha256: manifest.sha256 })
    expect(await readFile(staged.path)).toEqual(artifact)
    expect(await readFile(artifactPath)).toEqual(artifact)
    expect((await stat(staged.path)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(staged.path))).mode & 0o777).toBe(0o700)
    expect(await readdir(dirname(staged.path))).toEqual([basename])
  })

  it('requires a separately trusted key and rejects altered or corrupt signed metadata', async () => {
    await expect(stage(manifest, { policy: undefined })).rejects.toThrow(/trust is unavailable/)
    await expect(stage(manifest, {}, foreignKey)).rejects.toThrow(/signature/)
    await expect(stage(manifest, { signature: Buffer.alloc(64) })).rejects.toThrow(/signature/)
    const manifestBytes = Buffer.from('{broken')
    await expect(
      stage(manifest, { manifestBytes, signature: sign(null, manifestBytes, privateKey) })
    ).rejects.toThrow(SyntaxError)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects ambiguity even when someone signs JSON with duplicate keys or whitespace', async () => {
    for (const bytes of [
      Buffer.from(
        JSON.stringify(manifest).replace(
          '"product":"com.ashide.desktop"',
          '"product":"com.stably.os","product":"com.ashide.desktop"'
        )
      ),
      Buffer.from(JSON.stringify(manifest, null, 2))
    ]) {
      await expect(
        stage(manifest, {
          manifestBytes: bytes,
          signature: sign(null, bytes, privateKey)
        })
      ).rejects.toThrow(/canonical JSON/)
    }
    expect(await readdir(stageRoot)).toEqual([])
  })

  it.each([
    ['product', 'com.stably.os'],
    ['repository', 'stablyai/orca'],
    ['architecture', 'arm64'],
    ['platform', 'win32'],
    ['sha256', undefined],
    ['asset', 'Orca-linux.AppImage'],
    ['asset', '../ash-ide-linux.AppImage'],
    ['asset', 'https://onorca.dev/ash-ide-linux.AppImage'],
    ['tag', 'latest'],
    ['expiresAtMs', 1],
    ['issuedAtMs', Number.MAX_SAFE_INTEGER],
    ['expiresAtMs', Number.MAX_SAFE_INTEGER],
    ['version', '0.1.0']
  ])('rejects invalid signed %s (%s)', async (field, value) => {
    await expect(stage({ ...manifest, [field]: value })).rejects.toThrow()
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects same-size tampering, certified wrong CPU and unsigned filename impersonation', async () => {
    artifact.writeUInt16LE(183, 18)
    await writeFile(artifactPath, artifact)
    await expect(stage()).rejects.toThrow(/digest/)
    await expect(
      stage({ ...manifest, sha256: createHash('sha256').update(artifact).digest('hex') })
    ).rejects.toThrow(/architecture/)
    const foreignPath = join(root, 'Orca-linux.AppImage')
    await writeFile(foreignPath, artifact)
    await expect(stage(manifest, { artifactPath: foreignPath })).rejects.toThrow(/signed name/)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('rejects link aliases and a public staging directory, without modifying foreign files', async () => {
    const external = join(root, 'outside')
    await writeFile(external, artifact)
    await rm(artifactPath)
    await symlink(external, artifactPath)
    await expect(stage()).rejects.toThrow(/signed name/)
    await rm(artifactPath)
    await link(external, artifactPath)
    await expect(stage()).rejects.toThrow(/regular file/)
    await chmod(stageRoot, 0o755)
    await expect(stage()).rejects.toThrow(/private/)
    expect(await readFile(external)).toEqual(artifact)
    expect(await readdir(stageRoot)).toEqual([])
  })

  it('ignores abandoned partial directories and publishes a complete retry separately', async () => {
    const abandoned = join(stageRoot, '.ash-release-abandoned')
    await mkdir(abandoned, { mode: 0o700 })
    const partial = join(abandoned, '.partial')
    await writeFile(partial, 'crash witness')
    const staged = await stage()
    expect(await readdir(abandoned)).toEqual(['.partial'])
    expect(await readFile(partial, 'utf8')).toBe('crash witness')
    expect(await readFile(staged.path)).toEqual(artifact)
  })
})
