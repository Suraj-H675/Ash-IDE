import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearPreviousCliEmission } from './build-cli.mjs'

const fixtureRoots = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ash-cli-emission-'))
  fixtureRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CLI compiler stale-output protection', () => {
  it('accepts a clean checkout with no prior generated output', () => {
    const root = fixture()
    expect(() => clearPreviousCliEmission(root)).not.toThrow()
    expect(existsSync(join(root, 'out'))).toBe(false)
  })

  it('removes only obsolete CLI/shared compiler trees, not the Main build or other files', () => {
    const root = fixture()
    const out = join(root, 'out')
    mkdirSync(join(out, 'shared', 'plugins', 'installation'), { recursive: true })
    mkdirSync(join(out, 'cli'), { recursive: true })
    mkdirSync(join(out, 'main'), { recursive: true })
    const stale = join(out, 'shared', 'plugins', 'installation', 'plugin-git-arguments.js')
    writeFileSync(stale, 'retired app plugin artifact')
    writeFileSync(join(out, 'cli', 'index.js'), 'previous compiler output')
    writeFileSync(join(out, 'main', 'daemon-entry.js'), 'preserve Main output')
    writeFileSync(join(out, 'package.json'), '{"type":"commonjs"}')

    clearPreviousCliEmission(root)

    expect(existsSync(join(out, 'cli'))).toBe(false)
    expect(existsSync(join(out, 'shared'))).toBe(false)
    expect(readFileSync(join(out, 'main', 'daemon-entry.js'), 'utf8')).toBe('preserve Main output')
    expect(readFileSync(join(out, 'package.json'), 'utf8')).toBe('{"type":"commonjs"}')
  })

  it('fails closed if an output tree is redirected to unrelated user files', () => {
    const root = fixture()
    const other = fixture()
    const out = join(root, 'out')
    mkdirSync(join(out, 'cli'), { recursive: true })
    writeFileSync(join(out, 'cli', 'index.js'), 'keep on rejection')
    writeFileSync(join(other, 'do-not-touch'), 'sensitive data')
    symlinkSync(other, join(out, 'shared'), 'dir')

    expect(() => clearPreviousCliEmission(root)).toThrow(/Refusing to clean/)
    expect(readFileSync(join(out, 'cli', 'index.js'), 'utf8')).toBe('keep on rejection')
    expect(readFileSync(join(other, 'do-not-touch'), 'utf8')).toBe('sensitive data')
  })

  it('refuses a symlinked out root and any nonstandard output destination', () => {
    const root = fixture()
    const other = fixture()
    writeFileSync(join(other, 'do-not-touch'), 'sensitive data')
    symlinkSync(other, join(root, 'out'), 'dir')
    expect(() => clearPreviousCliEmission(root)).toThrow(/Refusing to clean/)
    expect(() => clearPreviousCliEmission(root, '.')).toThrow(/Refusing to clean/)
    expect(() => clearPreviousCliEmission(root, '../')).toThrow(/Refusing to clean/)
    expect(readFileSync(join(other, 'do-not-touch'), 'utf8')).toBe('sensitive data')
  })
})
