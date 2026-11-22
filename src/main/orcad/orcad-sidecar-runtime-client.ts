import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { z } from 'zod'
import { findTransport, type RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { BROWSER_UNAVAILABLE_ERROR_CODE } from '../../shared/runtime-types'
import { BrowserError } from '../browser/browser-error'
const SIDECAR_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/** Only bounded read-only probes opt in; browser sidecar streams retain their idle timeout. */
export type StrictLocalRpcBudget = {
  maxResponseBytes: number
  /** Fixed total deadline, cumulative bytes, and immediate socket destruction on settlement. */
  strict: true
}

const RuntimeResponse = z.discriminatedUnion('ok', [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }).passthrough(),
  z
    .object({
      id: z.string(),
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }).passthrough()
    })
    .passthrough()
])

export async function sendOrcadSidecarRequest(
  metadata: RuntimeMetadata,
  method: string,
  params: unknown,
  timeoutMs = 90_000,
  responseBudget: number | StrictLocalRpcBudget = SIDECAR_MAX_RESPONSE_BYTES
): Promise<unknown> {
  const strict = typeof responseBudget !== 'number'
  const maxResponseBytes = strict ? responseBudget.maxResponseBytes : responseBudget
  const transport = findTransport(metadata, 'unix', 'named-pipe')
  if (!transport) {
    throw new BrowserError(
      BROWSER_UNAVAILABLE_ERROR_CODE,
      'Electron browser sidecar has no local RPC transport.'
    )
  }
  return await new Promise((resolve, reject) => {
    const socket = createConnection(transport.endpoint)
    const requestId = randomUUID()
    let buffer = ''
    let retainedBytes = 0
    let receivedBytes = 0
    let settled = false
    const finish = (error: Error | null, result?: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (strict) {
        // A peer that never half-closes must not retain a completed diagnostic socket.
        socket.destroy()
      } else {
        socket.end()
      }
      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }
    const timer = setTimeout(() => {
      socket.destroy()
      finish(new BrowserError('browser_timeout', 'Electron browser sidecar request timed out.'))
    }, timeoutMs)
    timer.unref?.()
    socket.setEncoding('utf8')
    socket.once('error', () => {
      finish(
        new BrowserError(
          BROWSER_UNAVAILABLE_ERROR_CODE,
          'Could not connect to Electron browser sidecar.'
        )
      )
    })
    socket.once('close', () => {
      finish(
        new BrowserError(
          BROWSER_UNAVAILABLE_ERROR_CODE,
          'Electron browser sidecar closed before responding.'
        )
      )
    })
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const bytes = Buffer.byteLength(chunk, 'utf8')
      retainedBytes += bytes
      receivedBytes += bytes
      // Ordinary sidecar payloads retain the existing buffered limit. Strict
      // diagnostic probes account for every keepalive and every parsed line.
      if ((strict ? receivedBytes : retainedBytes) > maxResponseBytes) {
        socket.destroy()
        finish(new BrowserError('browser_error', 'Electron browser sidecar response is too large.'))
        return
      }
      // Avoid repeatedly flattening partial-line buffers.
      if (!chunk.includes('\n')) {
        return
      }
      let newline = buffer.indexOf('\n')
      while (newline !== -1 && !settled) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        retainedBytes = Buffer.byteLength(buffer, 'utf8')
        newline = buffer.indexOf('\n')
        if (!line.trim()) {
          continue
        }
        let raw: unknown
        try {
          raw = JSON.parse(line)
        } catch {
          finish(
            new BrowserError('browser_error', 'Electron browser sidecar returned invalid JSON.')
          )
          return
        }
        if (raw && typeof raw === 'object' && '_keepalive' in raw) {
          if (!strict) {
            timer.refresh()
          }
          continue
        }
        const parsed = RuntimeResponse.safeParse(raw)
        if (!parsed.success || parsed.data.id !== requestId) {
          finish(
            new BrowserError(
              'browser_error',
              'Electron browser sidecar returned an invalid response.'
            )
          )
          return
        }
        if (!parsed.data.ok) {
          const { code, message, data } = parsed.data.error
          finish(new BrowserError(code, message, data))
          return
        }
        finish(null, parsed.data.result)
      }
    })
    socket.on('connect', () => {
      socket.write(
        `${JSON.stringify({
          id: requestId,
          authToken: metadata.authToken,
          method,
          params
        })}\n`
      )
    })
  })
}
