import { describe, expect, it } from 'vitest'
import { effectiveAllowedFlags, parseArgs, validateCommandAndFlags } from './args'
import { ASH_COMMAND_SPECS, COMMAND_SPECS } from './specs'
import { RuntimeClientError } from './runtime/types'

const removedFlags = ['environment', 'pairing-code', 'host']

describe('Ash local-only public CLI boundary', () => {
  it.each(ASH_COMMAND_SPECS)(
    'rejects remote selectors for $path without suggesting them',
    (spec) => {
      for (const flag of removedFlags) {
        const parsed = parseArgs([...spec.path, `--${flag}`, 'fixture-remote'])
        let error: unknown
        try {
          validateCommandAndFlags(ASH_COMMAND_SPECS, parsed)
        } catch (caught) {
          error = caught
        }
        expect(error).toBeInstanceOf(RuntimeClientError)
        expect((error as RuntimeClientError).message).toContain(`Unknown flag --${flag}`)
        const recovery = JSON.stringify((error as RuntimeClientError).data)
        for (const retired of removedFlags) {
          expect(recovery).not.toContain(`--${retired}`)
        }
      }
      for (const flag of removedFlags) {
        expect(effectiveAllowedFlags(spec)).not.toContain(flag)
      }
    }
  )

  it.each([
    ['status', '--environment=fixture-remote'],
    ['status', '--pairing-code'],
    ['--environment', 'fixture-remote', 'status'],
    ['--pairing-code=fixture-remote', 'status']
  ])('rejects alternate remote flag syntax %j', (...argv) => {
    const parsed = parseArgs(
      argv,
      ASH_COMMAND_SPECS.map((spec) => spec.path),
      ASH_COMMAND_SPECS
    )
    expect(() => validateCommandAndFlags(ASH_COMMAND_SPECS, parsed)).toThrow(
      /Unknown flag --(?:environment|pairing-code)/
    )
  })

  it('retains local status JSON and existing non-Ash compatibility validation', () => {
    expect(() =>
      validateCommandAndFlags(ASH_COMMAND_SPECS, parseArgs(['status', '--json']))
    ).not.toThrow()
    expect(() =>
      validateCommandAndFlags(
        COMMAND_SPECS,
        parseArgs(['status', '--environment', 'fixture-remote'])
      )
    ).not.toThrow()
    expect(() =>
      validateCommandAndFlags(
        COMMAND_SPECS,
        parseArgs(['status', '--pairing-code', 'fixture-remote'])
      )
    ).not.toThrow()
  })
})
