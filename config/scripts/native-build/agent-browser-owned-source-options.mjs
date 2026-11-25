import { fail } from './agent-browser-owned-source-files.mjs'

export function parseOptions(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!key.startsWith('--') || values.has(key)) {
      fail(`Invalid or repeated option: ${key}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${key}`)
    }
    values.set(key, value)
    index += 1
  }
  return values
}

export function requiredOption(options, name) {
  const value = options.get(name)
  if (!value) {
    fail(`Missing required option ${name}`)
  }
  return value
}

export function assertKnownOptions(options, allowed) {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) {
      fail(`Unsupported option ${name}`)
    }
  }
}
