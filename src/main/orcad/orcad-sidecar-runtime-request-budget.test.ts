import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { sendOrcadSidecarRequest } from './orcad-sidecar-runtime-client'

const captured = vi.hoisted(() => ({
  clients: [] as Array<{ destroyed: boolean; readable: boolean }>
}))

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>()
  return {
    ...actual,
    createConnection: (endpoint: string) => {
      const client = actual.createConnection(endpoint)
      captured.clients.push(client)
      return client
    }
  }
})

async function withOwnedSocket(
  onRequest: (socket: Socket, request: { id: string }) => void,
  verify: (metadata: RuntimeMetadata, peers: Set<Socket>) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ash-runtime-budget-'))
  const endpoint = join(root, 'runtime.sock')
  const peers = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    peers.add(socket)
    socket.once('close', () => peers.delete(socket))
    socket.once('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString('utf8').trim()) as { id: string }
      onRequest(socket, request)
    })
  })
  server.listen(endpoint)
  await once(server, 'listening')
  const metadata: RuntimeMetadata = {
    runtimeId: 'fixture-runtime',
    pid: process.pid,
    startedAt: Date.now(),
    authToken: 'fixture-token',
    transports: [{ kind: 'unix', endpoint }]
  }
  try {
    await verify(metadata, peers)
  } finally {
    for (const peer of peers) peer.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}

const strict = (maxResponseBytes: number) => ({
  maxResponseBytes,
  strict: true as const
})

describe('RT-15 diagnostic local socket budget', () => {
  it.skipIf(process.platform === 'win32')(
    'retains the existing keepalive-refreshed idle timeout for ordinary browser sidecar calls',
    async () => {
      await withOwnedSocket(
        (socket, request) => {
          let sent = 0
          const ticker = setInterval(() => {
            sent += 1
            if (sent < 4) {
              socket.write('{"_keepalive":true}\n')
            } else {
              clearInterval(ticker)
              socket.write(`${JSON.stringify({ id: request.id, ok: true, result: 'legacy' })}\n`)
            }
          }, 30)
          socket.once('close', () => clearInterval(ticker))
        },
        async (metadata) => {
          expect(await sendOrcadSidecarRequest(metadata, 'browser.legacy', undefined, 55)).toBe(
            'legacy'
          )
        }
      )
    }
  )

  it.skipIf(process.platform === 'win32')(
    'ignores keepalives for its total 90ms deadline',
    async () => {
      await withOwnedSocket(
        (socket) => {
          const ticker = setInterval(() => socket.write('{"_keepalive":true}\n'), 20)
          socket.once('close', () => clearInterval(ticker))
        },
        async (metadata) => {
          const result = await Promise.race([
            sendOrcadSidecarRequest(
              metadata,
              'runtime.providerActivity',
              undefined,
              90,
              strict(8192)
            ).then(
              () => 'answered',
              (error: Error) => error.message
            ),
            new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 300))
          ])
          expect(result).toMatch(/timed out/i)
        }
      )
    }
  )

  it.skipIf(process.platform === 'win32')(
    'rejects cumulative keepalive bytes even when every line is smaller than its cap',
    async () => {
      await withOwnedSocket(
        (socket) => {
          const ticker = setInterval(() => socket.write('{"_keepalive":true}\n'), 12)
          socket.once('close', () => clearInterval(ticker))
        },
        async (metadata) => {
          const result = await Promise.race([
            sendOrcadSidecarRequest(
              metadata,
              'runtime.providerActivity',
              undefined,
              800,
              strict(128)
            ).then(
              () => 'answered',
              (error: Error) => error.message
            ),
            new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 400))
          ])
          expect(result).toMatch(/too large/i)
        }
      )
    }
  )

  it.skipIf(process.platform === 'win32')(
    'destroys a completed diagnostic socket even if the peer deliberately stays half-open',
    async () => {
      await withOwnedSocket(
        (socket, request) => {
          socket.write(`${JSON.stringify({ id: request.id, ok: true, result: 'observed' })}\n`)
          // Deliberately do not end the server side.
        },
        async (metadata) => {
          expect(
            await sendOrcadSidecarRequest(
              metadata,
              'runtime.providerActivity',
              undefined,
              800,
              strict(8192)
            )
          ).toBe('observed')
          const client = captured.clients.at(-1)
          expect(client).toBeDefined()
          await vi.waitFor(() => expect(client?.destroyed).toBe(true), { timeout: 500 })
          expect(client?.readable).toBe(false)
        }
      )
    }
  )
})
