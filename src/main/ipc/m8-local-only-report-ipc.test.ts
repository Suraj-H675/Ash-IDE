import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerDiagnosticsHandlers } from './diagnostics'
import { registerCrashReportingHandlers } from './crash-reporting/crash-reporting'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  tempDir: '',
  clipboard: vi.fn(),
  shellOpen: vi.fn(async () => ''),
  upload: vi.fn(() => {
    throw new Error('Vendor network upload must never run')
  }),
  remove: vi.fn(() => {
    throw new Error('Vendor network delete must never run')
  }),
  tokenEndpoint: vi.fn(() => {
    throw new Error('Vendor token endpoint must never resolve')
  }),
  crashUpload: vi.fn(() => {
    throw new Error('Vendor crash upload must never run')
  })
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => {
      fixture.handlers.set(name, handler)
    },
    removeHandler: (name: string) => {
      fixture.handlers.delete(name)
    },
    on: (name: string, handler: (...args: unknown[]) => unknown) => {
      fixture.listeners.set(name, handler)
    },
    removeAllListeners: (name: string) => {
      fixture.listeners.delete(name)
    }
  },
  app: {
    getPath: () => fixture.tempDir,
    getVersion: () => '0.1.0'
  },
  clipboard: { writeText: fixture.clipboard },
  shell: { openPath: fixture.shellOpen }
}))
vi.mock('../observability', () => ({
  getDiagnosticsStatus: () => ({
    localFileEnabled: true,
    bundleEnabled: true,
    traceFilePath: 'disposable.log',
    traceFamilySize: 0
  }),
  collectDiagnosticBundle: async () => ({
    bundleSubmissionId: 'ashfixture_1234567890',
    bytes: 24,
    spanCount: 1,
    payload: '{"redacted":true}\n'
  }),
  uploadDiagnosticBundle: fixture.upload,
  deleteDiagnosticBundle: fixture.remove
}))
vi.mock('../observability/diagnostic-upload-endpoint', () => ({
  resolveDiagnosticOrcaChannel: () => 'dev',
  resolveDiagnosticTokenEndpoint: fixture.tokenEndpoint
}))
vi.mock('./crash-reporting/crash-reporting-submission', () => ({
  buildUncapturedCrashReportText: () => 'local crash diagnostic',
  submitCrashReport: fixture.crashUpload
}))
vi.mock('./crash-reporting/crash-reporting-renderer-error-report', () => ({
  recentRendererErrorReportKeys: new Set(),
  recordRendererErrorReport: vi.fn()
}))
vi.mock('./crash-reporting/crash-reporting-renderer-breadcrumbs', () => ({
  recordRendererBreadcrumbFromRenderer: vi.fn()
}))
vi.mock('../crash-reporting/renderer-heap-allocation-profile', () => ({
  profiledRendererFor: vi.fn(),
  profileRendererMemoryBreadcrumb: vi.fn()
}))

afterEach(() => {
  fixture.handlers.clear()
  fixture.listeners.clear()
  vi.clearAllMocks()
  if (fixture.tempDir) {
    rmSync(fixture.tempDir, { recursive: true, force: true })
    fixture.tempDir = ''
  }
})

it('denies all inherited vendor submission/deletion actions while retaining local diagnostic review and crash copy', async () => {
  fixture.tempDir = mkdtempSync(join(tmpdir(), 'ash-local-report-ipc-'))
  const crashStore = {
    listRecent: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    dismiss: vi.fn(async () => null)
  }
  registerCrashReportingHandlers(crashStore as never)
  registerDiagnosticsHandlers()

  const call = (name: string, ...args: unknown[]): unknown => {
    const handler = fixture.handlers.get(name)
    expect(handler, `Missing handler ${name}`).toBeDefined()
    return handler!({ sender: { id: 1 } }, ...args)
  }

  await expect(call('crashReports:submit', { notes: 'private report' })).resolves.toMatchObject({
    ok: false,
    status: null,
    report: null,
    error: expect.stringContaining('does not upload')
  })
  await expect(call('diagnostics:uploadBundle', 'ashfixture_1234567890')).rejects.toThrow(
    'does not have a diagnostics upload backend'
  )
  await expect(call('diagnostics:deleteBundle', 'ashfixture_1234567890')).rejects.toThrow(
    'does not have an external diagnostics deletion backend'
  )

  expect(call('diagnostics:getStatus')).toMatchObject({
    localFileEnabled: true,
    bundleEnabled: true
  })
  const collected = (await call('diagnostics:collectBundle')) as {
    bundleSubmissionId: string
    bytes: number
  }
  expect(collected).toEqual({
    bundleSubmissionId: 'ashfixture_1234567890',
    bytes: 24,
    spanCount: 1
  })
  const privatePath = join(
    fixture.tempDir,
    'ash-diagnostic-bundle-previews',
    `${collected.bundleSubmissionId}.ndjson`
  )
  expect(readFileSync(privatePath, 'utf8')).toContain('redacted')
  await call('diagnostics:openBundlePreview', collected.bundleSubmissionId)
  expect(fixture.shellOpen).toHaveBeenCalledWith(privatePath)
  call('diagnostics:discardBundlePreview', collected.bundleSubmissionId)
  expect(existsSync(privatePath)).toBe(false)
  await expect(
    call('crashReports:copyLatestDiagnostics', { notes: 'safe local copy' })
  ).resolves.toEqual({
    ok: true
  })
  expect(fixture.clipboard).toHaveBeenCalledOnce()

  expect(fixture.crashUpload).not.toHaveBeenCalled()
  expect(fixture.upload).not.toHaveBeenCalled()
  expect(fixture.remove).not.toHaveBeenCalled()
  expect(fixture.tokenEndpoint).not.toHaveBeenCalled()
})
