import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalPtyProvider } from './local-pty-provider'

describe.skipIf(process.platform === 'win32')(
  'local PTY cancellation immediately after native dispatch',
  () => {
    let disposableHome = ''

    afterEach(() => {
      if (disposableHome) {
        rmSync(disposableHome, { recursive: true, force: true })
        disposableHome = ''
      }
    })

    it('observes the exact physical PTY generation exit before a routing pin is retired', async () => {
      disposableHome = mkdtempSync(join(realpathSync(tmpdir()), 'ash-pty-after-dispatch-cancel-'))
      const controller = new AbortController()
      const provider = new LocalPtyProvider()
      let returnedIdentity: { id: string; incarnationId: string } | null = null
      let exitIdentity: { id: string; incarnationId: string } | null = null
      let onExit!: (identity: { id: string; incarnationId: string }) => void
      const physicalExit = new Promise<{ id: string; incarnationId: string }>((resolve) => {
        onExit = resolve
      })

      const spawn = provider.spawn({
        cols: 80,
        rows: 24,
        cwd: disposableHome,
        shellOverride: '/bin/sh',
        env: { HOME: disposableHome, PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
        signal: controller.signal,
        onLocalPtySpawnReturned: (id, incarnationId) => {
          returnedIdentity = { id, incarnationId }
          // Exactly the raced window: dispatch succeeded but activation has not
          // yet attached the provider's ordinary exit listener.
          controller.abort()
        },
        onLocalPtyExit: (id, incarnationId) => {
          exitIdentity = { id, incarnationId }
          onExit({ id, incarnationId })
        }
      })
      await expect(spawn).rejects.toThrow()
      expect(returnedIdentity).not.toBeNull()
      const exit = await Promise.race([
        physicalExit,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('native PTY exit was not observed')), 4_000)
        )
      ])
      expect(exit).toEqual(returnedIdentity)
      expect(exitIdentity).toEqual(returnedIdentity)
    })
  }
)
