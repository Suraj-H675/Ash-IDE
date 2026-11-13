import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { packagedTerminalScratchPrefix } = require('./verify-packaged-daemon-entry.cjs')

describe('packaged terminal host scratch directory', () => {
  it('uses the configured short disk-backed temp root when it fits the Unix socket limit', () => {
    expect(packagedTerminalScratchPrefix({ directory: '/var/tmp', platform: 'linux' })).toBe(
      join('/var/tmp', 'oth-')
    )
  })

  it('falls back to the short platform default when the configured root is too long', () => {
    expect(
      packagedTerminalScratchPrefix({ directory: `/tmp/${'n'.repeat(150)}`, platform: 'darwin' })
    ).toBe('/tmp/oth-')
  })
})
