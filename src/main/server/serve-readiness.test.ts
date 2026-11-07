import { describe, expect, it } from 'vitest'

import {
  renderServeReadiness,
  ServeReadinessPublisher,
  type ServeReadiness
} from './serve-readiness'

const ready: ServeReadiness = {
  runtimeId: 'runtime-1',
  boundEndpoint: null,
  advertisedEndpoint: null,
  pairing: {
    available: false,
    reason: 'websocket_unavailable',
    guidance: 'WebSocket pairing is unavailable.'
  },
  managedWslCliReconciliation: 'settled',
}

describe('ServeReadinessPublisher', () => {
  it('reports the authenticated local runtime without network or pairing data', () => {
    const json = renderServeReadiness(ready, { mode: 'json' })
    expect(JSON.parse(json)).toEqual({
      type: 'ash_runtime_ready',
      schemaVersion: 1,
      runtimeId: 'runtime-1',
      managedWslCliReconciliation: 'settled'
    })
    expect(renderServeReadiness(ready, { mode: 'human' })).toContain('Ash local runtime ready')
    expect(json).not.toContain('pairing')
    expect(json).not.toContain('endpoint')
  })

  it('rejects concurrent and later duplicate publications', async () => {
    let finishWrite: (() => void) | undefined
    const publisher = new ServeReadinessPublisher(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    const first = publisher.publish(ready, { mode: 'json' })

    await expect(publisher.publish(ready, { mode: 'json' })).rejects.toThrow(
      'publication already publishing'
    )
    finishWrite?.()
    await first
    await expect(publisher.publish(ready, { mode: 'json' })).rejects.toThrow(
      'publication already published'
    )
  })

  it('surfaces write failures and does not retry a partial contract', async () => {
    const publisher = new ServeReadinessPublisher(async () => {
      throw new Error('stdout closed')
    })

    await expect(publisher.publish(ready, { mode: 'human' })).rejects.toThrow('stdout closed')
    await expect(publisher.publish(ready, { mode: 'human' })).rejects.toThrow(
      'publication already failed'
    )
  })
})
