import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}

describe('Ash desktop startup excludes the mobile vendor relay', () => {
  it('does not ship its removed service, startup installer, or mobile status publisher', () => {
    for (const file of [
      'src/main/startup/main-process-relay-startup.ts',
      'src/main/startup/main-process-relay-status.ts',
      'src/main/runtime/mobile-cloud-relay/desktop-relay-service.ts',
      'src/main/runtime/mobile-cloud-relay/desktop-relay-service-installer.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(false)
    }
  })

  it('keeps the desktop composition state and shutdown path free of vendor mobile relay hooks', () => {
    for (const file of [
      'src/main/startup/main-process-state.ts',
      'src/main/startup/main-process-quit.ts'
    ]) {
      const contents = source(file)
      for (const name of [
        'desktopRelayService',
        'desktopRelayInstaller',
        'desktopRelayStatus',
        'setMobileRelayPairingProvider',
        'mobile:relayStatusChanged'
      ]) {
        expect(contents.includes(name), `${file} contains ${name}`).toBe(false)
      }
    }
  })

  it('continues to preserve the retained shutdown and local runtime entry points', () => {
    const quit = source('src/main/startup/main-process-quit.ts')
    expect(quit).toContain('state.unsubscribeAgentAwakeStatusChanges?.()')
    expect(quit).toContain('state.rateLimits?.stop()')
    expect(quit).toContain('markHostShuttingDown()')

    const runtime = source('src/main/startup/main-process-runtime-launch.ts')
    expect(runtime).toContain('enableWebSocket: false')
    expect(runtime).not.toContain('startDesktopRelayService')
  })
})
