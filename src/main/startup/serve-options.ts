import { getServeFlagTypoError } from '../../shared/serve-option-validation'

export type ServeOptions = {
  json: boolean
}

const UNSUPPORTED_NETWORK_FLAGS = [
  '--port',
  '--serve-port',
  '--bind',
  '--host',
  '--expose-network',
  '--allow-network',
  '--web-client-root',
  '--pairing-address',
  '--serve-pairing-address',
  '--mobile-pairing',
  '--serve-mobile-pairing',
  '--no-pairing',
  '--serve-no-pairing',
  '--grant-desktop-control',
  '--serve-grant-desktop-control',
  '--project-root',
  '--serve-project-root',
  '--environment',
  '--recipe-json',
  '--serve-recipe-json'
] as const

function optionsBeforeTerminator(argv: readonly string[]): readonly string[] {
  const terminatorIndex = argv.indexOf('--')
  return terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex)
}

function hasFlag(argv: readonly string[], flags: readonly string[]): boolean {
  const flagNames = new Set(flags)
  return argv.some((token) => flagNames.has(token.split('=', 1)[0]!))
}

export function getServeOptions(argv: readonly string[]): ServeOptions {
  const optionsArgv = optionsBeforeTerminator(argv)
  const typoError = getServeFlagTypoError(optionsArgv)
  if (typoError) {
    throw new Error(typoError)
  }
  if (hasFlag(optionsArgv, UNSUPPORTED_NETWORK_FLAGS)) {
    throw new Error(
      'Ash serve accepts authenticated local clients only; ports, pairing, and remote recipe flags are unavailable.'
    )
  }

  return {
    // The CLI uses `flags.has('json')`, so even `--json=false` enables JSON output.
    json: hasFlag(optionsArgv, ['--serve-json', '--json'])
  }
}
