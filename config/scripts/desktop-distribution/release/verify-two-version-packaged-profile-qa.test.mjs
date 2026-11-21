import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  parseArgs,
  verifyTwoVersionPackagedProfileRecovery
} = require('./verify-two-version-packaged-profile-qa.cjs')

const options = Object.fromEntries(
  [
    'previous-resources',
    'candidate-resources',
    'previous-artifact',
    'candidate-artifact',
    'previous-report',
    'candidate-report',
    'previous-version',
    'candidate-version',
    'previous-sha256',
    'candidate-sha256'
  ].map((name) => [name, process.env[`ASH_M8_QA_${name.replaceAll('-', '_').toUpperCase()}`]])
)
const hasRealFixtures = process.platform === 'linux' && Object.values(options).every(Boolean)

describe('two-version packaged profile QA argument contract', () => {
  it('requires all ten explicit options and rejects unknown and duplicate flags', () => {
    expect(() => parseArgs([])).toThrow(/ten/)
    expect(() => parseArgs(['--previous-version', '0.1.0'])).toThrow(/ten/)
    const args = Object.entries(
      Object.fromEntries(Object.keys(options).map((key) => [key, key]))
    ).flatMap(([key, value]) => [`--${key}`, value])
    expect(parseArgs(args)).toEqual(
      Object.fromEntries(Object.keys(options).map((key) => [key, key]))
    )
    expect(() => parseArgs([...args.slice(0, -2), '--previous-version', '0.2.0'])).toThrow(
      /repeated/
    )
    expect(() => parseArgs([...args.slice(0, -2), '--unknown', 'value'])).toThrow(/Unknown/)
  })
})

describe.skipIf(!hasRealFixtures)('real two-version packaged profile QA', () => {
  it('reads both inspected packages, checkpoints both versions and rolls back safely', async () => {
    const result = await verifyTwoVersionPackagedProfileRecovery(options)
    expect(result).toMatchObject({
      status: 'PASS',
      versions: [options['previous-version'], options['candidate-version']],
      productionActivationAvailable: false
    })
  })

  it('rejects incorrect versions, image hashes, swapped reports and downgrade order', async () => {
    await expect(
      verifyTwoVersionPackagedProfileRecovery({
        ...options,
        'candidate-version': options['previous-version']
      })
    ).rejects.toThrow()
    await expect(
      verifyTwoVersionPackagedProfileRecovery({
        ...options,
        'candidate-sha256': '0'.repeat(64)
      })
    ).rejects.toThrow()
    await expect(
      verifyTwoVersionPackagedProfileRecovery({
        ...options,
        'candidate-report': options['previous-report']
      })
    ).rejects.toThrow()
    const reversed = Object.fromEntries(
      Object.keys(options).map((key) => [
        key,
        options[
          key.startsWith('previous-')
            ? key.replace('previous-', 'candidate-')
            : key.replace('candidate-', 'previous-')
        ]
      ])
    )
    await expect(verifyTwoVersionPackagedProfileRecovery(reversed)).rejects.toThrow(
      /Candidate must be newer/
    )
  })
})
