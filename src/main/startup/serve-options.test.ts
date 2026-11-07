import { describe, expect, it } from 'vitest'
import { getServeOptions } from './serve-options'

describe('Ash serve options', () => {
  it('accepts JSON readiness for the local runtime', () => {
    expect(getServeOptions(['ash-ide', 'serve', '--json'])).toEqual({ json: true })
    expect(getServeOptions(['ash-ide', 'serve'])).toEqual({ json: false })
  })

  it.each([
    ['--port', '6768'],
    ['--bind', '0.0.0.0'],
    ['--expose-network'],
    ['--mobile-pairing'],
    ['--pairing-address', '127.0.0.1'],
    ['--project-root', '/tmp/fixture'],
    ['--recipe-json']
  ])('rejects excluded network serve arguments %s', (...flags) => {
    expect(() => getServeOptions(['ash-ide', 'serve', ...flags])).toThrow(
      'Ash serve accepts authenticated local clients only'
    )
  })

  it('leaves Electron switches after the terminator alone', () => {
    expect(getServeOptions(['ash-ide', 'serve', '--', '--host', '127.0.0.1'])).toEqual({
      json: false
    })
  })
})
