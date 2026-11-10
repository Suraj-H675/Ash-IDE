import { expect, it } from 'vitest'
import { MOBILE_RPC_METHOD_ALLOWLIST } from './runtime-rpc-mobile-method-allowlist'
import { MOBILE_RPC_METHOD_ROUTES } from './runtime-rpc-mobile-method-routing'

it('does not allow scheduled automation RPC methods through mobile relay routing', () => {
  const excluded = [
    'automation.list',
    'automation.show',
    'automation.create',
    'automation.update',
    'automation.delete',
    'automation.runNow',
    'automation.runs'
  ]

  for (const method of excluded) {
    expect(MOBILE_RPC_METHOD_ROUTES.has(method), method).toBe(false)
    expect(MOBILE_RPC_METHOD_ALLOWLIST.has(method), method).toBe(false)
  }
})
