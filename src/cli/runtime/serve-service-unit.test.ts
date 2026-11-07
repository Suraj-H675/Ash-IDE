import { describe, expect, it } from 'vitest'
import { renderServeService, systemdQuote, type ServeServiceInput } from './serve-service-unit'

const base: ServeServiceInput = {
  platform: 'darwin',
  homeDir: '/Users/me',
  command: '/usr/local/bin/ash-ide',
  userDataPath: '/Users/me/Library/Application Support/ash-ide',
  defaultUserDataPath: '/Users/me/Library/Application Support/ash-ide',
  path: '/usr/local/bin:/usr/bin:/bin'
}

describe('renderServeService', () => {
  it('writes a LaunchAgent for the local runtime and stops after a give-up', () => {
    const spec = renderServeService(base)
    expect(spec.name).toBe('com.ashide.desktop.serve')
    expect(spec.unitPath).toBe('/Users/me/Library/LaunchAgents/com.ashide.desktop.serve.plist')
    expect(spec.content).toContain('<string>--supervise</string>')
    expect(spec.content).not.toContain('pairing')
    expect(spec.content).toMatch(/<key>ExitTimeOut<\/key>\s*<integer>90<\/integer>/)
    expect(spec.content).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/)
    expect(spec.content).toContain('<key>ASH_USER_DATA_PATH</key>')
  })

  it('gives another profile its own label and pins its userData', () => {
    const spec = renderServeService({ ...base, userDataPath: '/tmp/profile & co' })
    expect(spec.name).toMatch(/^com\.ashide\.desktop\.serve\.[0-9a-f]{8}$/)
    expect(spec.content).toContain('<string>/tmp/profile &amp; co</string>')
  })

  it('writes a systemd user unit with a start limit and quoted arguments', () => {
    const spec = renderServeService({
      ...base,
      platform: 'linux',
      homeDir: '/home/me',
      command: '/home/me/My Apps/ash-ide',
      userDataPath: '/home/me/.config/ash-ide',
      defaultUserDataPath: '/home/me/.config/ash-ide'
    })
    expect(spec.unitPath).toBe('/home/me/.config/systemd/user/ash-ide-serve.service')
    expect(spec.content).toContain('StartLimitBurst=5')
    expect(spec.content).toContain('TimeoutStopSec=90')
    expect(spec.content).toContain(
      'ExecStart="/home/me/My Apps/ash-ide" serve --supervise'
    )
    expect(spec.content).toContain('ASH_USER_DATA_PATH')
    expect(spec.content).not.toContain('ORCA_USER_DATA_PATH')
  })

  it('refuses Windows', () => {
    expect(() => renderServeService({ ...base, platform: 'win32' })).toThrow()
  })

  it('quotes for systemd', () => {
    expect(systemdQuote('plain')).toBe('plain')
    expect(systemdQuote('50%')).toBe('50%%')
    expect(systemdQuote('a "b"\\c')).toBe('"a \\"b\\"\\\\c"')
  })
})
