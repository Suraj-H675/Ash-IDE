import { expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'

it('does not register scheduled automation methods or permit historical mobile callers', async () => {
  const dispatcher = new RpcDispatcher({ runtime: new OrcaRuntimeService() })
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
    const request = { id: `excluded-${method}`, authToken: 'unused', method, params: {} }
    expect(await dispatcher.dispatch(request, { callerScope: { kind: 'owner' } })).toMatchObject({
      ok: false,
      error: { code: 'method_not_found' }
    })
    expect(await dispatcher.dispatch(request, { callerScope: { kind: 'mobile' } })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
  }
})
