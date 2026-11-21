import { verify } from 'node:crypto'
import { z } from 'zod'

export const APPIMAGE_ASSETS = Object.freeze({
  x64: Object.freeze({ name: 'ash-ide-linux.AppImage', elfMachine: 62 }),
  arm64: Object.freeze({ name: 'ash-ide-linux-arm64.AppImage', elfMachine: 183 })
})
export const MAX_MANIFEST_BYTES = 16 * 1024
export const MAX_ARTIFACT_BYTES = 2 * 1024 ** 3
export const MAX_MANIFEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

const stableVersion = z
  .string()
  .max(32)
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/)
export const packageInputIdentityClaimSchema = z.strictObject({
  schema: z.literal(1),
  evidenceKind: z.literal('packaging-input-snapshot'),
  appId: z.literal('com.ashide.desktop'),
  productName: z.literal('Ash IDE'),
  packageName: z.literal('ash-ide'),
  version: stableVersion,
  architecture: z.enum(['x64', 'arm64']),
  sourceCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  capturedAppAsarSha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedCompiledCliPackageJsonSha256: z.string().regex(/^[a-f0-9]{64}$/)
})
const manifestSchema = z.strictObject({
  schema: z.literal(1),
  product: z.literal('com.ashide.desktop'),
  repository: z.literal('Suraj-H675/Ash-IDE'),
  platform: z.literal('linux'),
  architecture: z.enum(['x64', 'arm64']),
  format: z.literal('AppImage'),
  version: stableVersion,
  tag: z.string().max(33),
  asset: z.string().max(64),
  size: z.number().int().min(20).max(MAX_ARTIFACT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  packageInputIdentityClaim: packageInputIdentityClaimSchema.optional(),
  issuedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive()
})

function isUpgrade(candidate, installed) {
  const current = stableVersion.parse(installed).split('.').map(Number)
  const difference = candidate
    .split('.')
    .map((part, index) => Number(part) - current[index])
    .find((delta) => delta !== 0)
  return difference > 0
}

export function authenticateAshReleaseManifest({
  manifestBytes,
  signature,
  policy,
  requireUpgrade = true
}) {
  if (policy?.publicKey?.asymmetricKeyType !== 'ed25519' || policy.publicKey.type !== 'public') {
    throw new Error('Ash release trust is unavailable')
  }
  if (
    !Buffer.isBuffer(manifestBytes) ||
    manifestBytes.length === 0 ||
    manifestBytes.length > MAX_MANIFEST_BYTES ||
    !Buffer.isBuffer(signature) ||
    signature.length !== 64 ||
    !verify(null, manifestBytes, policy.publicKey, signature)
  ) {
    throw new Error('Invalid Ash release manifest signature')
  }

  const source = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)
  const parsed = JSON.parse(source)
  if (JSON.stringify(parsed) !== source) {
    throw new Error('Ash release manifest must use compact canonical JSON without duplicate keys')
  }
  const manifest = manifestSchema.parse(parsed)
  const expected = APPIMAGE_ASSETS[manifest.architecture]
  const now = Date.now()
  if (
    policy.architecture !== manifest.architecture ||
    (requireUpgrade && !isUpgrade(manifest.version, policy.installedVersion)) ||
    manifest.tag !== `v${manifest.version}` ||
    manifest.asset !== expected.name ||
    manifest.issuedAtMs > now ||
    manifest.expiresAtMs <= now ||
    manifest.expiresAtMs - manifest.issuedAtMs > MAX_MANIFEST_LIFETIME_MS
  ) {
    throw new Error(
      'Ash release does not match the installed build or is outside its validity period'
    )
  }
  if (
    manifest.packageInputIdentityClaim &&
    (manifest.packageInputIdentityClaim.appId !== manifest.product ||
      manifest.packageInputIdentityClaim.version !== manifest.version ||
      manifest.packageInputIdentityClaim.architecture !== manifest.architecture)
  ) {
    throw new Error('Ash signed packaging identity does not match the signed release manifest')
  }
  return { manifest, expected }
}
