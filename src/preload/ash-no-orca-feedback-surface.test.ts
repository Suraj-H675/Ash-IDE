import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const projectRoot = process.cwd()
const source = (path: string): string => readFileSync(join(projectRoot, path), 'utf8')

it('removes the unused Orca feedback renderer and preload surface', () => {
  const preload = source('src/preload/index.ts')
  const preloadTypes = source('src/preload/api-types.ts')
  const crashReportApi = source('src/preload/api/crash-report-api.ts')

  expect(preload).not.toMatch(/feedbackApi|feedback-bridge|^\s*feedback\s*:/m)
  expect(preloadTypes).not.toMatch(/FeedbackApi|^\s*feedback\s*:/m)
  expect(crashReportApi).not.toMatch(/FeedbackApi|FeedbackSubmit/)
  expect(existsSync(join(projectRoot, 'src/preload/api/feedback-bridge.ts'))).toBe(false)
  expect(
    existsSync(join(projectRoot, 'src/renderer/src/components/sidebar/sidebar-feedback'))
  ).toBe(false)
})

it('retains the local crash report preload and copy path', () => {
  const preload = source('src/preload/index.ts')
  const bridge = source('src/preload/api/crash-reports-bridge.ts')
  const handlers = source('src/main/ipc/crash-reporting/crash-reporting.ts')

  expect(preload).toContain("import { crashReportsApi } from './api/crash-reports-bridge'")
  expect(preload).toContain('crashReports: crashReportsApi')
  expect(bridge).toContain("ipcRenderer.invoke('crashReports:copyLatestDiagnostics', args)")
  expect(handlers).toContain("'crashReports:copyLatestDiagnostics'")
})
