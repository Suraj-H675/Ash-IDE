import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { buildRemoteSettingsSections } from '../../../hooks/settings-navigation-remote-sections'

it('advertises local diagnostics, not an opt-in for excluded product analytics', () => {
  const sections = buildRemoteSettingsSections(
    { isMac: false, isWebClient: false, isDev: false, repos: [] } as never,
    { title: 'Runtime', description: 'Local runtime', keywords: ['runtime'] } as never,
    new Map()
  )
  const privacy = sections.find((section) => section.id === 'privacy')

  expect(privacy).toMatchObject({
    title: 'Privacy & Diagnostics',
    description: 'Review local diagnostic files and privacy safeguards.',
    group: 'security'
  })
  expect(JSON.stringify(privacy)).not.toMatch(/telemetry|anonymous usage|opt.in/i)
})

it('does not retain the obsolete product-telemetry consent overlay in renderer source', () => {
  for (const name of [
    'components/FirstLaunchBanner.tsx',
    'components/TelemetryFirstLaunchSurface.tsx',
    'components/dashboard-popout/use-agent-dashboard-telemetry.ts'
  ]) {
    expect(
      existsSync(resolve(process.cwd(), 'src/renderer/src', name)),
      `obsolete ${name} must not be packaged`
    ).toBe(false)
  }
})
