// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { requireLegacyAppPluginsApi } from './legacy-app-plugins-api'

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')
afterEach(() => {
  if (originalApi) {
    Object.defineProperty(window, 'api', originalApi)
  } else {
    Reflect.deleteProperty(window, 'api')
  }
})

describe('Ash built-in commands with the excluded application-plugin API', () => {
  it('fails explicitly instead of presenting a synthetic installer to unmounted Orca UI', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    expect(() => requireLegacyAppPluginsApi()).toThrow(
      'Application plugins are not supported in Ash IDE'
    )
  })
})
