import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAshPackageInputIdentityClaim } from './ash-package-input-identity.cjs'
import { REQUIRED_FILES } from './ash-appimage-embedded-identity-squashfs.mjs'

const APP_ID = 'com.ashide.desktop'
const PRODUCT_NAME = 'Ash IDE'
const stableVersion = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} is not valid UTF-8`)
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function parseDesktopIdentity(bytes) {
  const maxBytes = REQUIRED_FILES['com.ashide.desktop.desktop']
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error('Embedded desktop entry exceeds its size limit')
  }
  const source = decodeUtf8(bytes, 'Embedded desktop entry')
  const normalized = source.replace(/\r\n/g, '\n')
  if (normalized.includes('\r') || normalized.includes('\0')) {
    throw new Error('Embedded desktop entry contains an unsupported character')
  }
  const lines = normalized.split('\n')
  if (lines[0] !== '[Desktop Entry]') {
    throw new Error('Embedded desktop entry has no Desktop Entry section')
  }
  const values = new Map()
  // The first [Desktop Entry] header is already required above; every later
  // section, including another identical header, is ambiguous and rejected.
  for (const line of lines.slice(1)) {
    if (line === '' || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      throw new Error('Embedded desktop entry has an unexpected section')
    }
    const separator = line.indexOf('=')
    if (separator < 1) {
      throw new Error('Embedded desktop entry contains a malformed key')
    }
    const key = line.slice(0, separator)
    if (!/^[A-Za-z0-9-]+$/.test(key) || values.has(key)) {
      throw new Error('Embedded desktop entry contains an invalid or duplicate key')
    }
    values.set(key, line.slice(separator + 1))
  }
  const name = values.get('Name')
  const startupWmClass = values.get('StartupWMClass')
  const version = values.get('X-AppImage-Version')
  if (
    name !== PRODUCT_NAME ||
    startupWmClass !== APP_ID ||
    typeof version !== 'string' ||
    !stableVersion.test(version)
  ) {
    throw new Error('Embedded desktop entry does not identify the expected Ash IDE build')
  }
  return { name, startupWmClass, version }
}

export async function verifyEmbeddedIdentityFiles(files, architecture) {
  if (!['x64', 'arm64'].includes(architecture)) {
    throw new Error('Expected architecture must be x64 or arm64')
  }
  if (!(files instanceof Map) || files.size !== Object.keys(REQUIRED_FILES).length) {
    throw new Error('Embedded file set does not match the exact identity allowlist')
  }
  for (const [path, maxBytes] of Object.entries(REQUIRED_FILES)) {
    const bytes = files.get(path)
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
      throw new Error(`Embedded file is absent or exceeds its size limit: ${path}`)
    }
  }

  const desktop = parseDesktopIdentity(files.get('com.ashide.desktop.desktop'))
  let embeddedClaim
  try {
    embeddedClaim = JSON.parse(
      decodeUtf8(
        files.get('resources/ash-package-input-identity.json'),
        'Embedded identity sidecar'
      )
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Embedded identity sidecar')) {
      throw error
    }
    throw new Error('Embedded identity sidecar is not valid JSON')
  }
  if (embeddedClaim === null || typeof embeddedClaim !== 'object' || Array.isArray(embeddedClaim)) {
    throw new Error('Embedded identity sidecar is not an object')
  }

  const scratchRoot = await mkdtemp(join(tmpdir(), 'ash-appimage-identity-payload-'))
  try {
    const resourcesDir = join(scratchRoot, 'resources')
    const unpackedDir = join(resourcesDir, 'app.asar.unpacked')
    const compiledOutDir = join(unpackedDir, 'out')
    await mkdir(resourcesDir, { mode: 0o700 })
    await mkdir(unpackedDir, { mode: 0o700 })
    await mkdir(compiledOutDir, { mode: 0o700 })
    await writeFile(join(resourcesDir, 'app.asar'), files.get('resources/app.asar'), {
      flag: 'wx',
      mode: 0o600
    })
    await writeFile(
      join(compiledOutDir, 'package.json'),
      files.get('resources/app.asar.unpacked/out/package.json'),
      { flag: 'wx', mode: 0o600 }
    )
    await writeFile(
      join(resourcesDir, 'ash-package-input-identity.json'),
      files.get('resources/ash-package-input-identity.json'),
      { flag: 'wx', mode: 0o600 }
    )

    const recomputedClaim = await createAshPackageInputIdentityClaim({
      resourcesDir,
      appId: APP_ID,
      productName: PRODUCT_NAME,
      version: desktop.version,
      architecture,
      sourceCommit: embeddedClaim.sourceCommit
    })
    const expectedSidecar = Buffer.from(`${JSON.stringify(recomputedClaim)}\n`)
    if (!files.get('resources/ash-package-input-identity.json').equals(expectedSidecar)) {
      throw new Error('Embedded identity sidecar does not match recomputed package inputs')
    }
    return {
      claim: recomputedClaim,
      desktop,
      sidecarSha256: sha256(files.get('resources/ash-package-input-identity.json'))
    }
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }
}
