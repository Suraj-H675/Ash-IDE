import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { buildCapabilitySettingsSections } from '../hooks/settings-navigation-capability-sections'
import { requireLegacySpeechApi } from '../lib/require-legacy-speech-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('omits Voice from Ash settings without removing retained Computer Use', () => {
  const sections = buildCapabilitySettingsSections({
    isMac: false,
    isWindows: false,
    isLocalWindowsHost: false,
    isWindowsTerminalHost: false,
    isWebClient: false,
    hostQueuesMessages: false,
    managedBrowserCreationEnabled: true,
    mobileEmulatorCreationEnabled: true,
    isDev: false,
    isLinearConnected: false,
    repos: []
  })
  const ids = sections.map((section) => section.id)
  expect(ids).not.toContain('voice')
  expect(ids).toContain('computer-use')
  expect(ids).toContain('agents')
  expect(ids).toContain('accounts')
})

it('fails closed if an archived voice path is invoked without a desktop speech API', () => {
  vi.stubGlobal('window', { api: {} })
  expect(() => requireLegacySpeechApi()).toThrow(
    'Speech and dictation are not available in Ash IDE'
  )
})

it('keeps speech out of the desktop preload, root overlays, and mounted settings', () => {
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
  const preload = source('src/preload/index.ts')
  const root = source('src/renderer/src/app-shell/AppRootSurfaces.tsx')
  const settings = source(
    'src/renderer/src/components/settings/page/settings-capability-section-renderers.tsx'
  )
  const navigation = source('src/renderer/src/hooks/settings-navigation-capability-sections.ts')
  const audio = source('src/renderer/src/hooks/use-audio-capture.ts')

  expect(preload).not.toContain('speech-bridge')
  expect(preload).not.toMatch(/\bspeech:\s*speechApi\b/)
  expect(root).not.toContain('DictationController')
  expect(root).not.toContain('selectAppRootSurfaceVoiceEnabled')
  expect(settings).not.toContain('VoicePane')
  expect(navigation).not.toMatch(/\bid:\s*'voice'/)
  expect(
    audio.indexOf('requireLegacySpeechApi()', audio.indexOf('const start = useCallback'))
  ).toBeLessThan(
    audio.indexOf('openMicrophoneCaptureStream(', audio.indexOf('const start = useCallback'))
  )
})
